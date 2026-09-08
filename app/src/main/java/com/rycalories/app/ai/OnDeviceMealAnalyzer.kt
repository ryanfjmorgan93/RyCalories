package com.rycalories.app.ai

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.imagedescription.ImageDescriberOptions
import com.google.mlkit.genai.imagedescription.ImageDescription
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.ImagePart
import com.google.mlkit.genai.prompt.ModelPreference
import com.google.mlkit.genai.prompt.ModelReleaseStage
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import com.google.mlkit.genai.prompt.generateTypedContentRequest
import com.google.mlkit.genai.prompt.generationConfig
import com.google.mlkit.genai.prompt.modelConfig
import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.MealAnalysis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.withContext
import android.util.Log

/** Thrown with a message that is safe to show directly in the UI. */
class AnalysisException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Where the on-device model currently stands. */
sealed interface ModelState {
    data object Checking : ModelState
    data class Unavailable(val reason: String, val details: String) : ModelState
    data class Downloadable(val details: String) : ModelState
    data class Downloading(val downloadedBytes: Long, val totalBytes: Long) : ModelState
    data class Ready(val details: String) : ModelState
}

/**
 * Estimates calories with Gemini Nano running entirely on the phone, through ML Kit's
 * GenAI Prompt API. Nothing leaves the device and there is no API key.
 *
 * AICore publishes several model variants (full/fast, stable/preview) and not every one is
 * enabled on every phone, so [probe] tries them all and keeps the first that works.
 */
class OnDeviceMealAnalyzer(context: Context) : AutoCloseable {

    private val appContext = context.applicationContext
    private var model: GenerativeModel? = null
    private var modelLabel: String = "none"

    /** Some Nano builds (e.g. Samsung's Nano-v4) reject constrained decoding; remembered after the first refusal. */
    @Volatile private var structuredOutputUnsupported = false

    private data class Variant(val label: String, val preference: Int, val releaseStage: Int)

    private val variants = listOf(
        Variant("full / stable", ModelPreference.FULL, ModelReleaseStage.STABLE),
        Variant("fast / stable", ModelPreference.FAST, ModelReleaseStage.STABLE),
        Variant("full / preview", ModelPreference.FULL, ModelReleaseStage.PREVIEW),
        Variant("fast / preview", ModelPreference.FAST, ModelReleaseStage.PREVIEW),
    )

    private fun clientFor(v: Variant): GenerativeModel = Generation.getClient(
        generationConfig {
            modelConfig = modelConfig {
                preference = v.preference
                releaseStage = v.releaseStage
            }
        }
    )

    /** Checks every model variant, keeps the best one, and builds a diagnostics report. */
    suspend fun probe(): ModelState = withContext(Dispatchers.IO) {
        model?.let { runCatching { it.close() } }
        model = null
        modelLabel = "none"

        val report = StringBuilder()
        report.appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})")
        report.appendLine("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        if (Build.VERSION.SDK_INT >= 31) report.appendLine("SoC: ${Build.SOC_MANUFACTURER} ${Build.SOC_MODEL}")
        report.appendLine("AICore: ${versionOf("com.google.android.aicore")}")
        report.appendLine("Play services: ${versionOf("com.google.android.gms")}")
        report.appendLine()

        var best: Pair<Variant, Int>? = null
        val clients = mutableMapOf<String, GenerativeModel>()
        report.appendLine("Prompt API (Gemini Nano):")
        for (v in variants) {
            val status = try {
                val c = clientFor(v)
                clients[v.label] = c
                c.checkStatus()
            } catch (e: Exception) {
                report.appendLine("  ${v.label}: error ${e.javaClass.simpleName}: ${e.message}")
                continue
            }
            report.appendLine("  ${v.label}: ${statusName(status)}")
            if (best == null || rank(status) > rank(best.second)) best = v to status
        }

        report.appendLine()
        report.appendLine("Image Description API (older Nano feature, as a comparison):")
        try {
            val describer = ImageDescription.getClient(ImageDescriberOptions.builder(appContext).build())
            try {
                report.appendLine("  ${statusName(describer.checkFeatureStatus().await())}")
            } finally {
                runCatching { describer.close() }
            }
        } catch (e: Exception) {
            report.appendLine("  error ${e.javaClass.simpleName}: ${e.message}")
        }

        val chosen = best
        if (chosen != null && rank(chosen.second) > 0) {
            model = clients.remove(chosen.first.label)
            modelLabel = chosen.first.label
            runCatching { model?.getBaseModelName() }.getOrNull()?.let { report.appendLine("\nBase model: $it") }
        }
        clients.values.forEach { runCatching { it.close() } }
        report.appendLine("\nUsing: $modelLabel")

        val details = report.toString().trim()
        when (chosen?.second) {
            FeatureStatus.AVAILABLE -> ModelState.Ready(details)
            FeatureStatus.DOWNLOADABLE -> ModelState.Downloadable(details)
            FeatureStatus.DOWNLOADING -> ModelState.Downloading(0, 0)
            else -> ModelState.Unavailable(
                "AICore reports Gemini Nano as unavailable for this app on this phone. " +
                    "Google says this can happen right after an AICore update while it fetches new " +
                    "configuration: try again in a few minutes, and if it persists reinstall this app.",
                details,
            )
        }
    }

    /** Streams download progress; ends with [ModelState.Ready] or [ModelState.Unavailable]. */
    fun download(): Flow<ModelState> = flow {
        val m = model ?: run {
            emit(ModelState.Unavailable("No model variant is downloadable.", ""))
            return@flow
        }
        var total = 0L
        try {
            m.download().collect { status ->
                when (status) {
                    is DownloadStatus.DownloadStarted -> {
                        total = status.bytesToDownload
                        emit(ModelState.Downloading(0, total))
                    }
                    is DownloadStatus.DownloadProgress ->
                        emit(ModelState.Downloading(status.totalBytesDownloaded, total))
                    is DownloadStatus.DownloadFailed ->
                        emit(ModelState.Unavailable("Download failed: ${status.e.message}", ""))
                    is DownloadStatus.DownloadCompleted -> emit(ModelState.Ready("Downloaded ($modelLabel)"))
                }
            }
        } catch (e: Exception) {
            emit(ModelState.Unavailable("Download failed: ${e.message}", ""))
        }
    }.flowOn(Dispatchers.IO)

    suspend fun analyze(image: Bitmap?, description: String?): MealAnalysis =
        withContext(Dispatchers.IO) {
            val m = model ?: throw AnalysisException("The on-device model isn't ready. Check the model card on the home screen.")
            if (image == null && description.isNullOrBlank()) {
                throw AnalysisException("Take a photo or describe the meal first.")
            }

            val system = SystemInstruction(SYSTEM_PROMPT)
            val userText = buildUserPrompt(image != null, description)

            if (!structuredOutputUnsupported) {
                val request = buildRequest(system, image, userText)
                val typed = generateTypedContentRequest(request, NanoMealEstimate::class, true)
                try {
                    val response = m.generateContent(typed)
                    val estimate = response.candidates.firstOrNull()?.response
                        ?: throw AnalysisException("The model returned nothing. Try a clearer photo or more detail.")
                    return@withContext toAnalysis(estimate)
                } catch (e: GenAiException) {
                    if (isStructuredOutputRefusal(e)) {
                        Log.w(TAG, "Structured output unsupported on this device; using plain JSON", e)
                        structuredOutputUnsupported = true
                    } else {
                        throw AnalysisException("The on-device model failed (code ${e.errorCode}): ${e.message}", e)
                    }
                } catch (e: Exception) {
                    throw AnalysisException("Something went wrong running the model: ${e.message}", e)
                }
            }

            // Plain-text path: ask for JSON in the prompt and parse leniently.
            val request = buildRequest(system, image, userText + "\n\n" + NutritionJson.FORMAT_INSTRUCTIONS)
            val raw = try {
                m.generateContent(request).candidates.firstOrNull()?.text ?: ""
            } catch (e: GenAiException) {
                throw AnalysisException("The on-device model failed (code ${e.errorCode}): ${e.message}", e)
            } catch (e: Exception) {
                throw AnalysisException("Something went wrong running the model: ${e.message}", e)
            }
            Log.d(TAG, "Nano raw response: $raw")
            NutritionJson.parse(raw)
        }

    private fun buildRequest(system: SystemInstruction, image: Bitmap?, text: String) =
        if (image != null) {
            generateContentRequest(system, ImagePart(image), TextPart(text)) {
                temperature = 0.2f
                maxOutputTokens = 1024
            }
        } else {
            generateContentRequest(system, TextPart(text)) {
                temperature = 0.2f
                maxOutputTokens = 1024
            }
        }

    private fun isStructuredOutputRefusal(e: GenAiException): Boolean {
        val code = e.errorCode
        if (code == GenAiException.ErrorCode.STRUCTURED_OUTPUT_REQUEST_ERROR ||
            code == GenAiException.ErrorCode.STRUCTURED_OUTPUT_RESPONSE_ERROR ||
            code == GenAiException.ErrorCode.NOT_SUPPORTED
        ) return true
        return e.message?.contains("structured output", ignoreCase = true) == true
    }

    override fun close() {
        runCatching { model?.close() }
        model = null
    }

    private fun versionOf(pkg: String): String = try {
        val info = appContext.packageManager.getPackageInfo(pkg, 0)
        "${info.versionName} (${info.longVersionCode})"
    } catch (e: PackageManager.NameNotFoundException) {
        "not installed"
    }

    private fun statusName(s: Int) = when (s) {
        FeatureStatus.AVAILABLE -> "AVAILABLE"
        FeatureStatus.DOWNLOADABLE -> "DOWNLOADABLE"
        FeatureStatus.DOWNLOADING -> "DOWNLOADING"
        FeatureStatus.UNAVAILABLE -> "UNAVAILABLE"
        else -> "unknown ($s)"
    }

    private fun rank(s: Int) = when (s) {
        FeatureStatus.AVAILABLE -> 3
        FeatureStatus.DOWNLOADABLE -> 2
        FeatureStatus.DOWNLOADING -> 1
        else -> 0
    }

    private fun toAnalysis(e: NanoMealEstimate): MealAnalysis {
        val items = e.items.map {
            FoodItem(
                name = it.name.trim().ifBlank { "Item" },
                portion = it.portion.trim(),
                calories = it.calories.toDouble(),
                proteinG = it.proteinG.toDouble(),
                carbsG = it.carbsG.toDouble(),
                fatG = it.fatG.toDouble(),
                grams = it.grams.toDouble().takeIf { g -> g > 0 },
                brand = it.brand.trim(),
                product = it.product.trim(),
            )
        }
        // Totals are summed here rather than asked of the model, so they always add up.
        return MealAnalysis(
            mealName = e.mealName.trim().ifBlank { "Meal" },
            items = items,
            totalCalories = items.sumOf { it.calories },
            proteinG = items.sumOf { it.proteinG },
            carbsG = items.sumOf { it.carbsG },
            fatG = items.sumOf { it.fatG },
            confidence = e.confidence.lowercase().takeIf { it in setOf("low", "medium", "high") } ?: "medium",
            notes = e.notes.trim(),
        )
    }

    private fun buildUserPrompt(hasImage: Boolean, description: String?): String {
        val sb = StringBuilder()
        if (hasImage) {
            sb.append("Identify every food item in this photo of a meal and estimate its portion, calories, protein, carbs and fat.")
            if (!description.isNullOrBlank()) {
                sb.append(" Extra context: ").append(description.trim())
            }
        } else {
            sb.append("Estimate the portion, calories, protein, carbs and fat for each of these ingredients:\n")
            sb.append(description!!.trim())
        }
        return sb.toString()
    }

    companion object {
        private const val TAG = "OnDeviceMealAnalyzer"
        const val MODEL_NAME = "Gemini Nano (on-device)"

        private val SYSTEM_PROMPT = """
            You are a nutrition estimator inside a personal calorie-tracking app.
            Identify each food item, estimate a realistic portion size, and give calories plus
            protein, carbohydrates and fat in grams using standard USDA-style nutrition values.
            When something is ambiguous, pick the most likely interpretation and mention it in notes.
            Keep item names short. If an item is a packaged product, read the brand and product
            name exactly as printed and use the pack weight printed on it for the portion.
        """.trimIndent()
    }
}
