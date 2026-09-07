package com.rycalories.app.ai

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.genai.llminference.GraphOptions
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession
import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.MealAnalysis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Fallback engine: Gemma 3n (Google's open multimodal model) running on the phone through
 * MediaPipe's LLM Inference API. Used when AICore refuses to hand out Gemini Nano.
 * The model file (.litertlm, roughly 3 GB) is imported once by the user; after that it works
 * offline with no account or cost.
 */
class GemmaMealAnalyzer(context: Context, private val modelPath: String) : AutoCloseable {

    private val appContext = context.applicationContext
    private var llm: LlmInference? = null
    private var backendUsed: String = ""
    private val lock = Mutex()

    /** Loads the model into memory. Slow the first time (tens of seconds), then cached. */
    suspend fun load(): String = withContext(Dispatchers.IO) {
        lock.withLock {
            llm?.let { return@withLock backendUsed }
            if (!File(modelPath).exists()) throw AnalysisException("Gemma model file is missing. Import it again in Settings.")
            var lastError: Exception? = null
            for (backend in listOf(LlmInference.Backend.GPU, LlmInference.Backend.CPU)) {
                try {
                    val options = LlmInference.LlmInferenceOptions.builder()
                        .setModelPath(modelPath)
                        .setMaxTokens(2048)
                        .setMaxNumImages(1)
                        .setPreferredBackend(backend)
                        .build()
                    llm = LlmInference.createFromOptions(appContext, options)
                    backendUsed = backend.name
                    Log.i(TAG, "Loaded Gemma on $backend")
                    return@withLock backendUsed
                } catch (e: Exception) {
                    Log.w(TAG, "Gemma failed to load on $backend", e)
                    lastError = e
                }
            }
            throw AnalysisException("Could not load the Gemma model: ${lastError?.message}", lastError)
        }
    }

    suspend fun analyze(image: Bitmap?, description: String?): MealAnalysis = withContext(Dispatchers.IO) {
        if (image == null && description.isNullOrBlank()) {
            throw AnalysisException("Take a photo or describe the meal first.")
        }
        load()
        val engine = llm ?: throw AnalysisException("Gemma model isn't loaded.")

        val raw = lock.withLock {
            val sessionOptions = LlmInferenceSession.LlmInferenceSessionOptions.builder()
                .setTopK(40)
                .setTemperature(0.2f)
                .setGraphOptions(GraphOptions.builder().setEnableVisionModality(image != null).build())
                .build()
            val session = try {
                LlmInferenceSession.createFromOptions(engine, sessionOptions)
            } catch (e: Exception) {
                throw AnalysisException("Could not start a Gemma session: ${e.message}", e)
            }
            try {
                session.addQueryChunk(buildPrompt(image != null, description))
                if (image != null) {
                    session.addImage(BitmapImageBuilder(fitForModel(image)).build())
                }
                session.generateResponse()
            } catch (e: Exception) {
                throw AnalysisException("Gemma failed while analysing: ${e.message}", e)
            } finally {
                runCatching { session.close() }
            }
        }
        Log.d(TAG, "Gemma raw response: $raw")
        parse(raw)
    }

    fun modelPathMatches(path: String) = path == modelPath

    override fun close() {
        runCatching { llm?.close() }
        llm = null
    }

    /** Gemma 3n's vision encoder works at modest resolutions; bigger only costs time. */
    private fun fitForModel(bitmap: Bitmap, maxEdge: Int = 768): Bitmap {
        val longest = maxOf(bitmap.width, bitmap.height)
        if (longest <= maxEdge) return bitmap
        val scale = maxEdge.toFloat() / longest
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).toInt().coerceAtLeast(1),
            (bitmap.height * scale).toInt().coerceAtLeast(1),
            true,
        )
    }

    private fun buildPrompt(hasImage: Boolean, description: String?): String {
        val task = if (hasImage) {
            buildString {
                append("Look at this photo of a meal. Identify every food item, estimate a realistic portion size, ")
                append("and estimate calories, protein, carbs and fat for each item using standard nutrition values.")
                if (!description.isNullOrBlank()) append(" Extra context from the user: ").append(description.trim())
            }
        } else {
            "Estimate a realistic portion size, calories, protein, carbs and fat for each of these ingredients " +
                "using standard nutrition values:\n" + description!!.trim()
        }
        return """
            You are a nutrition estimator inside a calorie-tracking app.
            $task

            Reply with ONLY a JSON object, no markdown, no commentary, in exactly this shape:
            {"meal_name":"short name","items":[{"name":"food","portion":"1 cup","calories":250,"protein_g":10,"carbs_g":30,"fat_g":8}],"confidence":"low|medium|high","notes":"one sentence on assumptions"}
        """.trimIndent()
    }

    private fun parse(raw: String): MealAnalysis {
        val start = raw.indexOf('{')
        val end = raw.lastIndexOf('}')
        if (start < 0 || end <= start) {
            throw AnalysisException("Gemma didn't return a usable answer. Try again or add more detail.")
        }
        val json = try {
            JSONObject(raw.substring(start, end + 1))
        } catch (e: Exception) {
            throw AnalysisException("Gemma's answer wasn't valid JSON. Try again.", e)
        }
        val arr = json.optJSONArray("items") ?: JSONArray()
        val items = (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            FoodItem(
                name = o.optString("name", "Item").trim().ifBlank { "Item" },
                portion = o.optString("portion", "").trim(),
                calories = o.optDouble("calories", 0.0).coerceIn(0.0, 5000.0),
                proteinG = o.optDouble("protein_g", 0.0).coerceIn(0.0, 500.0),
                carbsG = o.optDouble("carbs_g", 0.0).coerceIn(0.0, 1000.0),
                fatG = o.optDouble("fat_g", 0.0).coerceIn(0.0, 500.0),
            )
        }
        if (items.isEmpty()) throw AnalysisException("Gemma couldn't identify any food. Try a clearer photo.")
        val confidence = json.optString("confidence", "medium").lowercase()
        return MealAnalysis(
            mealName = json.optString("meal_name", "Meal").trim().ifBlank { "Meal" },
            items = items,
            totalCalories = items.sumOf { it.calories },
            proteinG = items.sumOf { it.proteinG },
            carbsG = items.sumOf { it.carbsG },
            fatG = items.sumOf { it.fatG },
            confidence = if (confidence in setOf("low", "medium", "high")) confidence else "medium",
            notes = json.optString("notes", "").trim(),
        )
    }

    companion object {
        private const val TAG = "GemmaMealAnalyzer"
        const val MODEL_NAME = "Gemma 3n (on-device)"
        const val MODEL_FILE_NAME = "gemma-3n.litertlm"
    }
}
