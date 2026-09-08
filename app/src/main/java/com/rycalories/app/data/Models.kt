package com.rycalories.app.data

import org.json.JSONArray
import org.json.JSONObject

data class FoodItem(
    val name: String,
    val portion: String,
    val calories: Double,
    val proteinG: Double,
    val carbsG: Double,
    val fatG: Double,
    /** Estimated weight of this portion in grams, if the model gave one. */
    val grams: Double? = null,
    /** Brand and product as read off packaging; blank for unpackaged food. */
    val brand: String = "",
    val product: String = "",
    /** "model" for an estimate, "label" when the numbers came from the product's nutrition label. */
    val source: String = "model",
) {
    val isPackaged: Boolean get() = product.isNotBlank() || brand.isNotBlank()

    fun toJson(): JSONObject = JSONObject()
        .put("name", name)
        .put("portion", portion)
        .put("calories", calories)
        .put("protein_g", proteinG)
        .put("carbs_g", carbsG)
        .put("fat_g", fatG)
        .put("grams", grams ?: JSONObject.NULL)
        .put("brand", brand)
        .put("product", product)
        .put("source", source)

    companion object {
        fun fromJson(o: JSONObject) = FoodItem(
            name = o.optString("name", "Item"),
            portion = o.optString("portion", ""),
            calories = o.optDouble("calories", 0.0),
            proteinG = o.optDouble("protein_g", 0.0),
            carbsG = o.optDouble("carbs_g", 0.0),
            fatG = o.optDouble("fat_g", 0.0),
            grams = if (o.isNull("grams")) null else o.optDouble("grams"),
            brand = o.optString("brand", ""),
            product = o.optString("product", ""),
            source = o.optString("source", "model"),
        )
    }
}

/** What the model returns for one meal, before the user confirms or tweaks it. */
data class MealAnalysis(
    val mealName: String,
    val items: List<FoodItem>,
    val totalCalories: Double,
    val proteinG: Double,
    val carbsG: Double,
    val fatG: Double,
    val confidence: String,
    val notes: String,
) {
    /** Rebuild totals after items change. */
    fun withItems(newItems: List<FoodItem>, confidence: String = this.confidence, notes: String = this.notes) = copy(
        items = newItems,
        totalCalories = newItems.sumOf { it.calories },
        proteinG = newItems.sumOf { it.proteinG },
        carbsG = newItems.sumOf { it.carbsG },
        fatG = newItems.sumOf { it.fatG },
        confidence = confidence,
        notes = notes,
    )

    companion object {
        fun fromJson(o: JSONObject): MealAnalysis {
            val itemsArr = o.optJSONArray("items") ?: JSONArray()
            val items = (0 until itemsArr.length()).map { FoodItem.fromJson(itemsArr.getJSONObject(it)) }
            return MealAnalysis(
                mealName = o.optString("meal_name", "Meal"),
                items = items,
                totalCalories = o.optDouble("total_calories", items.sumOf { it.calories }),
                proteinG = o.optDouble("total_protein_g", items.sumOf { it.proteinG }),
                carbsG = o.optDouble("total_carbs_g", items.sumOf { it.carbsG }),
                fatG = o.optDouble("total_fat_g", items.sumOf { it.fatG }),
                confidence = o.optString("confidence", "medium"),
                notes = o.optString("notes", ""),
            )
        }
    }
}

data class Meal(
    val id: String,
    val timestampMillis: Long,
    val name: String,
    val items: List<FoodItem>,
    val calories: Double,
    val proteinG: Double,
    val carbsG: Double,
    val fatG: Double,
    val confidence: String,
    val notes: String,
    /** Absolute path to a JPEG inside the app's private storage, or null for text-only meals. */
    val photoPath: String?,
    /** The ingredient text the user typed, if any. */
    val ingredientText: String?,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("timestamp", timestampMillis)
        .put("name", name)
        .put("items", JSONArray(items.map { it.toJson() }))
        .put("calories", calories)
        .put("protein_g", proteinG)
        .put("carbs_g", carbsG)
        .put("fat_g", fatG)
        .put("confidence", confidence)
        .put("notes", notes)
        .put("photo_path", photoPath ?: JSONObject.NULL)
        .put("ingredient_text", ingredientText ?: JSONObject.NULL)

    companion object {
        fun fromJson(o: JSONObject): Meal {
            val itemsArr = o.optJSONArray("items") ?: JSONArray()
            return Meal(
                id = o.getString("id"),
                timestampMillis = o.getLong("timestamp"),
                name = o.optString("name", "Meal"),
                items = (0 until itemsArr.length()).map { FoodItem.fromJson(itemsArr.getJSONObject(it)) },
                calories = o.optDouble("calories", 0.0),
                proteinG = o.optDouble("protein_g", 0.0),
                carbsG = o.optDouble("carbs_g", 0.0),
                fatG = o.optDouble("fat_g", 0.0),
                confidence = o.optString("confidence", "medium"),
                notes = o.optString("notes", ""),
                photoPath = if (o.isNull("photo_path")) null else o.optString("photo_path"),
                ingredientText = if (o.isNull("ingredient_text")) null else o.optString("ingredient_text"),
            )
        }
    }
}
