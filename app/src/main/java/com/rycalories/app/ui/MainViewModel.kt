package com.rycalories.app.ui

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rycalories.app.ai.AnalysisException
import com.rycalories.app.ai.ModelState
import com.rycalories.app.ai.OnDeviceMealAnalyzer
import com.rycalories.app.data.AppSettings
import com.rycalories.app.data.Meal
import com.rycalories.app.data.MealAnalysis
import com.rycalories.app.data.MealRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

sealed interface Screen {
    data object Home : Screen
    data object AddMeal : Screen
    data object Result : Screen
    data object Settings : Screen
    data class Detail(val mealId: String) : Screen
}

data class DraftState(
    val bitmap: Bitmap? = null,
    val jpeg: ByteArray? = null,
    val description: String = "",
    val analyzing: Boolean = false,
    val error: String? = null,
    val analysis: MealAnalysis? = null,
    /** User-adjustable multiplier applied to the estimate when saving (e.g. ate half = 0.5). */
    val portionMultiplier: Float = 1f,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val repository = MealRepository(app)
    val settings = AppSettings(app)
    private val analyzer = OnDeviceMealAnalyzer(app)

    private val _modelState = MutableStateFlow<ModelState>(ModelState.Checking)
    val modelState: StateFlow<ModelState> = _modelState.asStateFlow()

    private val _screen = MutableStateFlow<Screen>(Screen.Home)
    val screen: StateFlow<Screen> = _screen.asStateFlow()

    private val _draft = MutableStateFlow(DraftState())
    val draft: StateFlow<DraftState> = _draft.asStateFlow()

    private val _selectedDay = MutableStateFlow(startOfToday())
    val selectedDay: StateFlow<Long> = _selectedDay.asStateFlow()

    init {
        viewModelScope.launch { repository.load() }
        refreshModelState()
    }

    override fun onCleared() {
        analyzer.close()
        super.onCleared()
    }

    fun refreshModelState() {
        viewModelScope.launch {
            _modelState.value = ModelState.Checking
            _modelState.value = analyzer.probe()
        }
    }

    fun downloadModel() {
        if (_modelState.value is ModelState.Downloading) return
        viewModelScope.launch {
            _modelState.value = ModelState.Downloading(0, 0)
            analyzer.download().collect { _modelState.value = it }
            if (_modelState.value !is ModelState.Ready) {
                // Re-check in case AICore finished in the background without reporting.
                _modelState.value = analyzer.probe()
            }
        }
    }

    fun navigate(to: Screen) {
        _screen.value = to
    }

    fun back() {
        _screen.value = when (_screen.value) {
            Screen.Result -> Screen.AddMeal
            else -> Screen.Home
        }
    }

    fun shiftDay(days: Int) {
        _selectedDay.update { it + days * DAY_MS }
    }

    fun goToToday() {
        _selectedDay.value = startOfToday()
    }

    fun startNewMeal() {
        _draft.value = DraftState()
        _screen.value = Screen.AddMeal
    }

    fun setDescription(text: String) = _draft.update { it.copy(description = text, error = null) }

    fun setPortionMultiplier(m: Float) = _draft.update { it.copy(portionMultiplier = m) }

    fun clearPhoto() = _draft.update { it.copy(bitmap = null, jpeg = null) }

    fun setPhoto(uri: Uri) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val bmp = ImageUtils.loadScaled(getApplication(), uri)
                        ?: error("Could not read that image")
                    bmp to ImageUtils.toJpeg(bmp)
                }
            }
            result.onSuccess { (bmp, jpeg) ->
                _draft.update { it.copy(bitmap = bmp, jpeg = jpeg, error = null) }
            }.onFailure { e ->
                _draft.update { it.copy(error = e.message ?: "Could not read that image") }
            }
        }
    }

    fun analyze() {
        val d = _draft.value
        if (d.analyzing) return
        _draft.update { it.copy(analyzing = true, error = null) }
        viewModelScope.launch {
            try {
                val analysis = analyzer.analyze(d.bitmap, d.description.ifBlank { null })
                _draft.update { it.copy(analyzing = false, analysis = analysis, portionMultiplier = 1f) }
                _screen.value = Screen.Result
            } catch (e: AnalysisException) {
                _draft.update { it.copy(analyzing = false, error = e.message) }
            } catch (e: Exception) {
                _draft.update { it.copy(analyzing = false, error = "Something went wrong: ${e.message}") }
            }
        }
    }

    fun saveAnalyzedMeal() {
        val d = _draft.value
        val a = d.analysis ?: return
        val m = d.portionMultiplier.toDouble()
        viewModelScope.launch {
            val id = UUID.randomUUID().toString()
            val photoPath = d.jpeg?.let { bytes ->
                withContext(Dispatchers.IO) { ImageUtils.saveJpeg(bytes, repository.photoDir, id).absolutePath }
            }
            val meal = Meal(
                id = id,
                timestampMillis = System.currentTimeMillis(),
                name = a.mealName,
                items = a.items.map {
                    it.copy(
                        calories = it.calories * m,
                        proteinG = it.proteinG * m,
                        carbsG = it.carbsG * m,
                        fatG = it.fatG * m,
                    )
                },
                calories = a.totalCalories * m,
                proteinG = a.proteinG * m,
                carbsG = a.carbsG * m,
                fatG = a.fatG * m,
                confidence = a.confidence,
                notes = a.notes,
                photoPath = photoPath,
                ingredientText = d.description.ifBlank { null },
            )
            repository.add(meal)
            _draft.value = DraftState()
            goToToday()
            _screen.value = Screen.Home
        }
    }

    fun deleteMeal(id: String) {
        viewModelScope.launch {
            repository.delete(id)
            if (_screen.value is Screen.Detail) _screen.value = Screen.Home
        }
    }

    fun saveSettings(goal: Int) {
        settings.save(goal)
        _screen.value = Screen.Home
    }

    companion object {
        const val DAY_MS = 24L * 60 * 60 * 1000

        fun startOfToday(): Long = startOfDay(System.currentTimeMillis())

        fun startOfDay(millis: Long): Long {
            val cal = java.util.Calendar.getInstance().apply {
                timeInMillis = millis
                set(java.util.Calendar.HOUR_OF_DAY, 0)
                set(java.util.Calendar.MINUTE, 0)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }
            return cal.timeInMillis
        }
    }
}
