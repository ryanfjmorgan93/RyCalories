package com.rycalories.app.ai

import android.util.Base64
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.errors.AnthropicInvalidDataException
import com.anthropic.errors.AnthropicIoException
import com.anthropic.errors.AnthropicServiceException
import com.anthropic.errors.RateLimitException
import com.anthropic.errors.UnauthorizedException
import com.anthropic.models.beta.messages.BetaBase64ImageSource
import com.anthropic.models.beta.messages.BetaContentBlockParam
import com.anthropic.models.beta.messages.BetaImageBlockParam
import com.anthropic.models.beta.messages.BetaJsonOutputFormat
import com.anthropic.models.beta.messages.BetaOutputConfig
import com.anthropic.models.beta.messages.BetaStopReason
import com.anthropic.models.beta.messages.BetaThinkingConfigAdaptive
import com.anthropic.models.beta.messages.MessageCreateParams
import com.rycalories.app.data.MealAnalysis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Thrown with a message that is safe to show directly in the UI. */
class AnalysisException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Sends a meal photo and/or an ingredient description to Claude and returns a structured
 * calorie + macro estimate. Uses the official Anthropic Java SDK with structured outputs
 * so the response is guaranteed to match [SCHEMA].
 */
class ClaudeMealAnalyzer(private val apiKey: String) {

    suspend fun analyze(imageJpeg: ByteArray?, description: String?): MealAnalysis =
        withContext(Dispatchers.IO) {
            if (apiKey.isBlank()) throw AnalysisException("Add your Anthropic API key in Settings first.")
            if (imageJpeg == null && description.isNullOrBlank()) {
                throw AnalysisException("Take a photo or describe the meal first.")
            }

            val client = AnthropicOkHttpClient.builder().apiKey(apiKey).build()
            try {
                val blocks = mutableListOf<BetaContentBlockParam>()
                if (imageJpeg != null) {
                    val b64 = Base64.encodeToString(imageJpeg, Base64.NO_WRAP)
                    blocks += BetaContentBlockParam.ofImage(
                        BetaImageBlockParam.builder()
                            .source(
                                BetaBase64ImageSource.builder()
                                    .mediaType(BetaBase64ImageSource.MediaType.IMAGE_JPEG)
                                    .data(b64)
                                    .build()
                            )
                            .build()
                    )
                }
                blocks += BetaContentBlockParam.ofText(buildUserPrompt(imageJpeg != null, description))

                val params = MessageCreateParams.builder()
                    .model(MODEL)
                    .maxTokens(4096L)
                    .system(SYSTEM_PROMPT)
                    .thinking(BetaThinkingConfigAdaptive.builder().build())
                    .outputConfig(
                        BetaOutputConfig.builder()
                            .effort(BetaOutputConfig.Effort.MEDIUM)
                            .format(BetaJsonOutputFormat.builder().schema(schema()).build())
                            .build()
                    )
                    // Server-side refusal fallbacks: if a safety classifier declines, Anthropic
                    // re-routes the request to a fallback model instead of returning nothing.
                    .addBeta("server-side-fallback-2026-07-01")
                    .fallbacksDefault()
                    .addUserMessageOfBetaContentBlockParams(blocks)
                    .build()

                val response = client.beta().messages().create(params)

                val stop = response.stopReason().orElse(null)
                if (stop == BetaStopReason.REFUSAL) {
                    throw AnalysisException("Claude declined to analyze this. Try a different photo or description.")
                }
                if (stop == BetaStopReason.MAX_TOKENS) {
                    throw AnalysisException("The response was cut off. Try again with a simpler meal.")
                }

                val text = response.content()
                    .mapNotNull { block -> block.text().orElse(null)?.text() }
                    .joinToString("")
                    .trim()
                if (text.isEmpty()) throw AnalysisException("Claude returned an empty response. Try again.")

                val json = try {
                    JSONObject(text)
                } catch (e: Exception) {
                    throw AnalysisException("Could not parse Claude's response.", e)
                }
                MealAnalysis.fromJson(json)
            } catch (e: AnalysisException) {
                throw e
            } catch (e: UnauthorizedException) {
                throw AnalysisException("API key was rejected. Check it in Settings.", e)
            } catch (e: RateLimitException) {
                throw AnalysisException("Rate limited by the API. Wait a moment and try again.", e)
            } catch (e: AnthropicServiceException) {
                throw AnalysisException("API error (${e.statusCode()}): ${e.message ?: "unknown"}", e)
            } catch (e: AnthropicIoException) {
                throw AnalysisException("Network problem. Check your connection and try again.", e)
            } catch (e: AnthropicInvalidDataException) {
                throw AnalysisException("Unexpected response from the API.", e)
            } finally {
                client.close()
            }
        }

    private fun buildUserPrompt(hasImage: Boolean, description: String?): String {
        val sb = StringBuilder()
        if (hasImage) {
            sb.append("Estimate the calories and macros for the meal in this photo.")
            if (!description.isNullOrBlank()) {
                sb.append(" Extra context from me: ").append(description.trim())
            }
        } else {
            sb.append("Estimate the calories and macros for a meal made of these ingredients:\n")
            sb.append(description!!.trim())
        }
        return sb.toString()
    }

    companion object {
        const val MODEL = "claude-opus-5"

        private val SYSTEM_PROMPT = """
            You are a nutrition estimator inside a personal calorie-tracking app.
            Given a photo of a meal and/or a list of ingredients, identify each food item,
            estimate a realistic portion size, and give calories plus protein, carbs and fat in grams.
            Use typical serving sizes and standard nutrition data (USDA-style values).
            When the photo is ambiguous, pick the most likely interpretation and say so in notes.
            Keep item names short. Use 'confidence' to reflect how sure you are of the portions.
            Totals must equal the sum of the items.
        """.trimIndent()

        private fun schema(): BetaJsonOutputFormat.Schema {
            val itemSchema = mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "name" to mapOf("type" to "string", "description" to "Short food item name"),
                    "portion" to mapOf("type" to "string", "description" to "Estimated portion, e.g. '1 cup' or '150 g'"),
                    "calories" to mapOf("type" to "number"),
                    "protein_g" to mapOf("type" to "number"),
                    "carbs_g" to mapOf("type" to "number"),
                    "fat_g" to mapOf("type" to "number"),
                ),
                "required" to listOf("name", "portion", "calories", "protein_g", "carbs_g", "fat_g"),
                "additionalProperties" to false,
            )
            val root = mapOf(
                "type" to "object",
                "properties" to mapOf(
                    "meal_name" to mapOf("type" to "string", "description" to "A short name for the whole meal"),
                    "items" to mapOf("type" to "array", "items" to itemSchema),
                    "total_calories" to mapOf("type" to "number"),
                    "total_protein_g" to mapOf("type" to "number"),
                    "total_carbs_g" to mapOf("type" to "number"),
                    "total_fat_g" to mapOf("type" to "number"),
                    "confidence" to mapOf("type" to "string", "enum" to listOf("low", "medium", "high")),
                    "notes" to mapOf("type" to "string", "description" to "Assumptions made, one or two sentences"),
                ),
                "required" to listOf(
                    "meal_name", "items", "total_calories", "total_protein_g",
                    "total_carbs_g", "total_fat_g", "confidence", "notes",
                ),
                "additionalProperties" to false,
            )
            val builder = BetaJsonOutputFormat.Schema.builder()
            root.forEach { (k, v) -> builder.putAdditionalProperty(k, JsonValue.from(v)) }
            return builder.build()
        }
    }
}
