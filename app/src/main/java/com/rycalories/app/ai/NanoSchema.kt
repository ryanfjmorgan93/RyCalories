package com.rycalories.app.ai

import com.google.mlkit.genai.schema.annotations.Generable
import com.google.mlkit.genai.schema.annotations.Guide

/**
 * Structured-output schema for Gemini Nano. The ML Kit schema compiler turns these
 * annotations into a constrained-decoding grammar, so the model can only answer in this shape.
 * Integers are used on purpose: small models are more reliable with them than with decimals.
 */
@Generable(description = "A single food item that is part of a meal")
data class NanoFoodItem(
    @Guide(description = "Short name of the food, e.g. 'Grilled chicken breast'")
    val name: String,
    @Guide(description = "Estimated portion size, e.g. '1 cup', '150 g', '2 slices'")
    val portion: String,
    @Guide(description = "Calories (kcal) in this portion", minimum = 0.0, maximum = 3000.0)
    val calories: Int,
    @Guide(description = "Protein in grams", minimum = 0.0, maximum = 300.0)
    val proteinG: Int,
    @Guide(description = "Carbohydrates in grams", minimum = 0.0, maximum = 500.0)
    val carbsG: Int,
    @Guide(description = "Fat in grams", minimum = 0.0, maximum = 300.0)
    val fatG: Int,
)

@Generable(description = "Nutrition estimate for one meal")
data class NanoMealEstimate(
    @Guide(description = "A short name for the whole meal, e.g. 'Chicken salad with bread'")
    val mealName: String,
    @Guide(description = "Every distinct food item visible or listed", minItems = 1, maxItems = 10)
    val items: List<NanoFoodItem>,
    @Guide(
        description = "How sure you are about the portion sizes",
        enumValues = ["low", "medium", "high"],
    )
    val confidence: String,
    @Guide(description = "One sentence on the assumptions made about portions or ingredients")
    val notes: String,
)
