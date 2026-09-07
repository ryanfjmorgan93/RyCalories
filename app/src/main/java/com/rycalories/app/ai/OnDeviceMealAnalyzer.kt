package com.rycalories.app.ai

import android.graphics.Bitmap
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.ImagePart
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import com.google.mlkit.genai.prompt.generateTypedContentRequest
import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.MealAnalysis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext

/** Thrown with a message that is safe to show directly in the UI. */
class AnalysisException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Where the on-device model currently stands. */
sealed interface ModelState {
    data object Checking : ModelState
    data class Unavailable(val reason: String) : ModelState
    data object Downloadable : ModelState
    data class Downloading(val downloadedBytes: Long, val totalBytes: Long) : ModelState
    data object Ready : ModelState
}

/**
 * Estimates calories with Gemini Nano running entirely on the phone, through ML Kit's
 * GenAI Prompt API. Nothing leaves the device and there is no API key.
 */
class OnDeviceMealAnalyzer : AutoCloseable {

    private val model: GenerativeModel by lazy { Generation.getClient() }

    suspend fun checkState(): ModelState = withContext(Dispatchers.IO) {
        try {
            when (model.checkStatus()) {
                FeatureStatus.AVAILABLE -> ModelState.Ready
                FeatureStatus.DOWNLOADABLE -> ModelState.Downloadable
                FeatureStatus.DOWNLOADING -> ModelState.Downloading(0, 0)
                else -> ModelState.Unavailable(
                    "Gemini Nano isn't available on this phone. It needs a supported device " +
                        "with Google's AICore app installed and up to date."
                )
            }
        } catch (e: Exception) {
            ModelState.Unavailable("Could not talk to the on-device model: ${e.message}")
        }
    }

    /** Streams download progress; ends with [ModelState.Ready] or [ModelState.Unavailable]. */
    fun download(): Flow<ModelState> = flow {
        var total = 0L
        try {
            model.download().collect { status ->
                when (status) {
                    is DownloadStatus.DownloadStarted -> {
                        total = status.bytesToDownload
                        emit(ModelState.Downloading(0, total))
                    }
                    is DownloadStatus.DownloadProgress ->
                        emit(ModelState.Downloading(status.totalBytesDownloaded, total))
                    is DownloadStatus.DownloadFailed ->
                        emit(ModelState.Unavailable("Download failed: ${status.e.message}"))
                    is DownloadStatus.DownloadCompleted -> emit(ModelState.Ready)
                }
            }
        } catch (e: Exception) {
            emit(ModelState.Unavailable("Download failed: ${e.message}"))
        }
    }.flowOn(Dispatchers.IO)

    suspend fun analyze(image: Bitmap?, description: String?): MealAnalysis =
        withContext(Dispatchers.IO) {
            if (image == null && description.isNullOrBlank()) {
                throw AnalysisException("Take a photo or describe the meal first.")
            }

            val system = SystemInstruction(SYSTEM_PROMPT)
            val text = TextPart(buildUserPrompt(image != null, description))
            val request = if (image != null) {
                generateContentRequest(system, ImagePart(image), text) {
                    temperature = 0.2f
                    maxOutputTokens = 1024
                }
            } else {
                generateContentRequest(system, text) {
                    temperature = 0.2f
                    maxOutputTokens = 1024
                }
            }

            val typed = generateTypedContentRequest(request, NanoMealEstimate::class, true)
            val response = try {
                model.generateContent(typed)
            } catch (e: GenAiException) {
                throw AnalysisException("The on-device model failed: ${e.message}", e)
            } catch (e: Exception) {
                throw AnalysisException("Something went wrong running the model: ${e.message}", e)
            }

            val estimate = response.candidates.firstOrNull()?.response
                ?: throw AnalysisException("The model returned nothing. Try a clearer photo or more detail.")
            toAnalysis(estimate)
        }

    override fun close() {
        runCatching { model.close() }
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
        const val MODEL_NAME = "Gemini Nano (on-device)"

        private val SYSTEM_PROMPT = """
            You are a nutrition estimator inside a personal calorie-tracking app.
            Identify each food item, estimate a realistic portion size, and give calories plus
            protein, carbohydrates and fat in grams using standard USDA-style nutrition values.
            When something is ambiguous, pick the most likely interpretation and mention it in notes.
            Keep item names short.
        """.trimIndent()
    }
}
