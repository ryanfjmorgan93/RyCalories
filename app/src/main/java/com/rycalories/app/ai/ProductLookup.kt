package com.rycalories.app.ai

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.rycalories.app.data.FoodItem
import com.rycalories.app.data.MealAnalysis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale

/**
 * Turns "the model recognised a Trek bar" into the Trek bar's real label numbers.
 *
 * Two routes, both automatic:
 *  1. a barcode visible in the photo (read on-device) -> exact product;
 *  2. the brand + product name the model read off the packaging -> best database match.
 * Open Food Facts is the source: free, open, no account. The only data sent is the barcode
 * digits or the product name. Results are cached so repeat foods work offline.
 */
class ProductLookup(context: Context) {

    private val appContext = context.applicationContext
    private val cacheFile = File(appContext.filesDir, "product_cache.json")
    private val cache: JSONObject by lazy {
        runCatching { JSONObject(cacheFile.readText()) }.getOrDefault(JSONObject())
    }

    data class LabelNutrition(
        val code: String,
        val brand: String,
        val name: String,
        val kcal100: Double,
        val protein100: Double,
        val carbs100: Double,
        val fat100: Double,
        val servingGrams: Double?,
        val packGrams: Double?,
    )

    /** Photo-only enrichment: never asks the user anything. Returns the analysis unchanged on any failure. */
    suspend fun enrich(analysis: MealAnalysis, photoForBarcodes: Bitmap?): MealAnalysis = withContext(Dispatchers.IO) {
        val items = analysis.items.toMutableList()
        var changed = false
        val notes = mutableListOf<String>()

        // Route 1: barcodes in the photo.
        val codes = photoForBarcodes?.let { runCatching { scanBarcodes(it) }.getOrDefault(emptyList()) } ?: emptyList()
        for (code in codes) {
            val label = runCatching { byBarcode(code) }.getOrNull() ?: continue
            val idx = bestItemFor(items, "${label.brand} ${label.name}").takeIf { it >= 0 }
                ?: items.indexOfFirst { it.source != "label" }.takeIf { it >= 0 }
                ?: continue
            items[idx] = apply(label, items[idx])
            notes += "${items[idx].name}: label values via barcode."
            changed = true
        }

        // Route 2: packaged items the model named.
        for (i in items.indices) {
            val item = items[i]
            if (item.source == "label" || !item.isPackaged) continue
            val query = "${item.brand} ${item.product}".trim().ifBlank { item.name }
            val label = runCatching { byName(query) }.getOrNull() ?: continue
            items[i] = apply(label, item)
            notes += "${items[i].name}: label values matched from the packaging."
            changed = true
        }

        if (!changed) return@withContext analysis
        val allLabel = items.all { it.source == "label" }
        val newNotes = (listOfNotNull(analysis.notes.takeIf { it.isNotBlank() }) + notes).joinToString(" ")
        analysis.withItems(items, confidence = if (allLabel) "high" else analysis.confidence, notes = newNotes)
    }

    private fun apply(label: LabelNutrition, item: FoodItem): FoodItem {
        val grams = label.servingGrams
            ?: label.packGrams?.takeIf { it in 10.0..300.0 }
            ?: item.grams?.takeIf { it > 0 }
            ?: 100.0
        val f = grams / 100.0
        val prettyName = listOf(label.brand, label.name)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .let { if (it == it.uppercase(Locale.ROOT)) it.lowercase(Locale.ROOT).split(" ").joinToString(" ") { w -> w.replaceFirstChar { c -> c.titlecase(Locale.ROOT) } } else it }
        val portion = when {
            label.servingGrams != null -> "1 serving (${grams.toInt()} g)"
            label.packGrams != null && grams == label.packGrams -> "1 pack (${grams.toInt()} g)"
            else -> "${grams.toInt()} g"
        }
        return item.copy(
            name = prettyName.ifBlank { item.name },
            portion = portion,
            grams = grams,
            calories = label.kcal100 * f,
            proteinG = label.protein100 * f,
            carbsG = label.carbs100 * f,
            fatG = label.fat100 * f,
            brand = label.brand.ifBlank { item.brand },
            product = label.name.ifBlank { item.product },
            source = "label",
        )
    }

    // ---- barcode -------------------------------------------------------------------------

    private suspend fun scanBarcodes(bitmap: Bitmap): List<String> {
        val options = BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
            .build()
        val scanner = BarcodeScanning.getClient(options)
        return try {
            scanner.process(InputImage.fromBitmap(bitmap, 0)).await()
                .mapNotNull { it.rawValue?.filter(Char::isDigit) }
                .filter { it.length in 8..14 }
                .distinct()
                .also { if (it.isNotEmpty()) Log.i(TAG, "Barcodes in photo: $it") }
        } finally {
            runCatching { scanner.close() }
        }
    }

    private fun byBarcode(code: String): LabelNutrition? {
        cached("code:$code")?.let { return it }
        val url = "https://world.openfoodfacts.org/api/v2/product/$code.json?fields=$FIELDS"
        val json = JSONObject(get(url))
        if (json.optInt("status", 0) != 1) return null
        return parseProduct(json.getJSONObject("product"))?.also { remember("code:$code", it) }
    }

    // ---- name ----------------------------------------------------------------------------

    private fun byName(query: String): LabelNutrition? {
        val key = "name:" + query.lowercase(Locale.ROOT).trim()
        cached(key)?.let { return it }
        val url = "https://search.openfoodfacts.org/search?q=${URLEncoder.encode(query, "UTF-8")}&page_size=10&fields=$FIELDS"
        val hits = JSONObject(get(url)).optJSONArray("hits") ?: return null
        val qTokens = tokens(query)
        if (qTokens.isEmpty()) return null
        val candidates = mutableListOf<Pair<LabelNutrition, Double>>()
        for (i in 0 until hits.length()) {
            val p = hits.optJSONObject(i) ?: continue
            val label = parseProduct(p) ?: continue
            val cTokens = tokens("${label.brand} ${label.name}")
            if (cTokens.isEmpty()) continue
            val overlap = qTokens.count { it in cTokens }.toDouble() / qTokens.size
            if (overlap >= 0.5) candidates += label to overlap
        }
        if (candidates.isEmpty()) {
            Log.i(TAG, "Name lookup '$query' -> no match")
            return null
        }
        // Best by name overlap, with a small bonus for entries that know their serving or pack size.
        var best = candidates.maxBy { (l, sc) -> sc + (if (l.servingGrams != null || l.packGrams != null) 0.1 else 0.0) }.first
        // Database entries are patchy: if the best match lacks a pack size, borrow one from a
        // sibling entry of the same brand (e.g. another flavour of the same bar).
        if (best.servingGrams == null && best.packGrams == null) {
            val sibling = candidates.map { it.first }
                .filter { it.brand.equals(best.brand, ignoreCase = true) }
                .firstNotNullOfOrNull { it.servingGrams ?: it.packGrams?.takeIf { g -> g in 10.0..300.0 } }
            if (sibling != null) best = best.copy(packGrams = sibling)
        }
        Log.i(TAG, "Name lookup '$query' -> ${best.brand} ${best.name} (${best.kcal100} kcal/100g, pack ${best.packGrams} g)")
        return best.also { remember(key, it) }
    }

    private fun tokens(s: String): Set<String> =
        s.lowercase(Locale.ROOT).split(Regex("[^a-z0-9]+"))
            .filter { it.length > 1 && it !in STOP }
            .map { if (it.length > 3 && it.endsWith("s")) it.dropLast(1) else it } // flapjacks == flapjack
            .toSet()

    // ---- parsing -------------------------------------------------------------------------

    private fun parseProduct(p: JSONObject): LabelNutrition? {
        val n = p.optJSONObject("nutriments") ?: return null
        val kcal = n.num("energy-kcal_100g") ?: n.num("energy-kcal")?.takeIf { n.optString("energy-kcal_unit", "kcal") == "kcal" } ?: return null
        val brand = p.optString("brands", "").split(",").firstOrNull()?.trim().orEmpty()
        val name = p.optString("product_name", "").trim()
        if (name.isBlank()) return null
        return LabelNutrition(
            code = p.optString("code", ""),
            brand = brand,
            name = name,
            kcal100 = kcal,
            protein100 = n.num("proteins_100g") ?: 0.0,
            carbs100 = n.num("carbohydrates_100g") ?: 0.0,
            fat100 = n.num("fat_100g") ?: 0.0,
            servingGrams = p.num("serving_quantity")?.takeIf { it > 0 } ?: parseGrams(p.optString("serving_size", "")),
            packGrams = p.num("product_quantity")?.takeIf { it > 0 } ?: parseGrams(p.optString("quantity", "")),
        )
    }

    /** "50 g", "50g", "6 x 50g" -> 50.0; "330 ml" -> 330.0; anything else -> null. */
    private fun parseGrams(text: String): Double? {
        val m = Regex("(\\d+(?:[.,]\\d+)?)\\s*(g|ml)\\b", RegexOption.IGNORE_CASE).findAll(text).lastOrNull() ?: return null
        return m.groupValues[1].replace(',', '.').toDoubleOrNull()
    }

    private fun JSONObject.num(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        return optDouble(key).takeIf { !it.isNaN() } ?: optString(key).toDoubleOrNull()
    }

    private fun bestItemFor(items: List<FoodItem>, name: String): Int {
        val target = tokens(name)
        var best = -1
        var bestScore = 0.0
        items.forEachIndexed { i, it ->
            val t = tokens("${it.brand} ${it.product} ${it.name}")
            if (t.isEmpty() || target.isEmpty()) return@forEachIndexed
            val score = target.count { x -> x in t }.toDouble() / target.size
            if (score > bestScore) { bestScore = score; best = i }
        }
        return if (bestScore >= 0.3) best else -1
    }

    // ---- cache + http --------------------------------------------------------------------

    private fun cached(key: String): LabelNutrition? {
        val o = cache.optJSONObject(key) ?: return null
        return LabelNutrition(
            code = o.optString("code"), brand = o.optString("brand"), name = o.optString("name"),
            kcal100 = o.optDouble("kcal100"), protein100 = o.optDouble("protein100"),
            carbs100 = o.optDouble("carbs100"), fat100 = o.optDouble("fat100"),
            servingGrams = if (o.isNull("servingGrams")) null else o.optDouble("servingGrams"),
            packGrams = if (o.isNull("packGrams")) null else o.optDouble("packGrams"),
        )
    }

    private fun remember(key: String, l: LabelNutrition) {
        cache.put(
            key, JSONObject()
                .put("code", l.code).put("brand", l.brand).put("name", l.name)
                .put("kcal100", l.kcal100).put("protein100", l.protein100)
                .put("carbs100", l.carbs100).put("fat100", l.fat100)
                .put("servingGrams", l.servingGrams ?: JSONObject.NULL)
                .put("packGrams", l.packGrams ?: JSONObject.NULL)
        )
        runCatching { cacheFile.writeText(cache.toString()) }
    }

    private fun get(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 6000
        conn.readTimeout = 8000
        conn.setRequestProperty("User-Agent", "RyCalories/1.0 (personal Android app)")
        conn.setRequestProperty("Accept", "application/json")
        try {
            if (conn.responseCode !in 200..299) throw IllegalStateException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        private const val TAG = "ProductLookup"
        private const val FIELDS = "code,product_name,brands,quantity,serving_size,serving_quantity,product_quantity,nutriments"
        private val STOP = setOf("the", "and", "with", "of", "bar", "bars", "pack", "snack", "flavour", "flavor")
    }
}
