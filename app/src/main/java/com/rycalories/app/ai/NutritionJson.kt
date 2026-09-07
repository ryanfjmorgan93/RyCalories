package com.rycalories.app.ai

import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.MealAnalysis
import org.json.JSONArray
import org.json.JSONObject

/**
 * Plain-text JSON contract used when a model can't do constrained decoding.
 * Shared by the Gemini Nano fallback path and the Gemma engine.
 */
object NutritionJson {

    const val FORMAT_INSTRUCTIONS = """Reply with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{"meal_name":"short name","items":[{"name":"food","portion":"1 cup","calories":250,"protein_g":10,"carbs_g":30,"fat_g":8}],"confidence":"low|medium|high","notes":"one sentence on assumptions"}"""

    fun parse(raw: String): MealAnalysis {
        val start = raw.indexOf('{')
        val end = raw.lastIndexOf('}')
        if (start < 0 || end <= start) {
            throw AnalysisException("The model didn't return a usable answer. Try again or add more detail.")
        }
        val json = try {
            JSONObject(raw.substring(start, end + 1))
        } catch (e: Exception) {
            throw AnalysisException("The model's answer wasn't valid JSON. Try again.", e)
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
        if (items.isEmpty()) throw AnalysisException("The model couldn't identify any food. Try a clearer photo or more detail.")
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
}
