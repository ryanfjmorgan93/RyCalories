package com.rycalories.app.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Stores meals as a single JSON file in the app's private storage.
 * No database, no cloud: everything stays on the phone.
 */
class MealRepository(context: Context) {
    private val appContext = context.applicationContext
    private val storeFile = File(appContext.filesDir, "meals.json")
    val photoDir: File = File(appContext.filesDir, "photos").apply { mkdirs() }

    private val _meals = MutableStateFlow<List<Meal>>(emptyList())
    val meals: StateFlow<List<Meal>> = _meals.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        if (!storeFile.exists()) return@withContext
        val loaded = runCatching {
            val root = JSONObject(storeFile.readText())
            val arr = root.optJSONArray("meals") ?: JSONArray()
            (0 until arr.length()).map { Meal.fromJson(arr.getJSONObject(it)) }
        }.getOrDefault(emptyList())
        _meals.value = loaded.sortedByDescending { it.timestampMillis }
    }

    suspend fun add(meal: Meal) {
        _meals.value = (_meals.value + meal).sortedByDescending { it.timestampMillis }
        persist()
    }

    suspend fun update(meal: Meal) {
        _meals.value = _meals.value.map { if (it.id == meal.id) meal else it }
            .sortedByDescending { it.timestampMillis }
        persist()
    }

    suspend fun delete(id: String) {
        val victim = _meals.value.firstOrNull { it.id == id }
        _meals.value = _meals.value.filterNot { it.id == id }
        persist()
        victim?.photoPath?.let { path -> withContext(Dispatchers.IO) { File(path).delete() } }
    }

    private suspend fun persist() = withContext(Dispatchers.IO) {
        val root = JSONObject().put("meals", JSONArray(_meals.value.map { it.toJson() }))
        val tmp = File(storeFile.parentFile, storeFile.name + ".tmp")
        tmp.writeText(root.toString())
        if (!tmp.renameTo(storeFile)) {
            storeFile.writeText(root.toString())
            tmp.delete()
        }
    }
}
