package com.rycalories.app.ui

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import android.provider.OpenableColumns
import com.rycalories.app.ai.AnalysisException
import com.rycalories.app.ai.GemmaMealAnalyzer
import com.rycalories.app.ai.ModelState
import com.rycalories.app.ai.OnDeviceMealAnalyzer
import com.rycalories.app.ai.ProductLookup
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
import java.io.File
import java.util.UUID

/** State of the imported Gemma 3n fallback model. */
sealed interface GemmaState {
    data object None : GemmaState
    data class Importing(val copiedBytes: Long, val totalBytes: Long) : GemmaState
    data class Ready(val path: String, val sizeBytes: Long) : GemmaState
    data class Error(val message: String) : GemmaState
}

enum class Engine { NANO, GEMMA, NONE }

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
    /** Source of the photo, kept so a higher-resolution copy can be decoded for barcode reading. */
    val uri: Uri? = null,
    val description: String = "",
    val analyzing: Boolean = false,
    val stage: String = "",
    val error: String? = null,
    val analysis: MealAnalysis? = null,
    /** User-adjustable multiplier applied to the estimate when saving (e.g. ate half = 0.5). */
    val portionMultiplier: Float = 1f,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val repository = MealRepository(app)
    val settings = AppSettings(app)
    private val analyzer = OnDeviceMealAnalyzer(app)
    private val lookup = ProductLookup(app)

    private val _modelState = MutableStateFlow<ModelState>(ModelState.Checking)
    val modelState: StateFlow<ModelState> = _modelState.asStateFlow()

    private var gemma: GemmaMealAnalyzer? = null
    private val _gemmaState = MutableStateFlow<GemmaState>(GemmaState.None)
    val gemmaState: StateFlow<GemmaState> = _gemmaState.asStateFlow()

    /** Which engine a new analysis would use right now. Nano when AICore allows it, else Gemma. */
    fun activeEngine(): Engine = when {
        _modelState.value is ModelState.Ready -> Engine.NANO
        _gemmaState.value is GemmaState.Ready -> Engine.GEMMA
        else -> Engine.NONE
    }

    private val _screen = MutableStateFlow<Screen>(Screen.Home)
    val screen: StateFlow<Screen> = _screen.asStateFlow()

    private val _draft = MutableStateFlow(DraftState())
    val draft: StateFlow<DraftState> = _draft.asStateFlow()

    private val _selectedDay = MutableStateFlow(startOfToday())
    val selectedDay: StateFlow<Long> = _selectedDay.asStateFlow()

    init {
        viewModelScope.launch { repository.load() }
        refreshModelState()
        settings.state.value.gemmaModelPath?.let { path ->
            val f = File(path)
            if (f.exists() && f.length() > 0) {
                _gemmaState.value = GemmaState.Ready(path, f.length())
            } else {
                settings.saveGemmaModelPath(null)
            }
        }
    }

    override fun onCleared() {
        analyzer.close()
        gemma?.close()
        super.onCleared()
    }

    /** Copies a user-picked Gemma 3n .litertlm file into private storage so MediaPipe can open it by path. */
    fun importGemmaModel(uri: Uri) {
        if (_gemmaState.value is GemmaState.Importing) return
        viewModelScope.launch {
            val ctx = getApplication<Application>()
            val dir = File(ctx.filesDir, "models").apply { mkdirs() }
            val target = File(dir, GemmaMealAnalyzer.MODEL_FILE_NAME)
            val tmp = File(dir, GemmaMealAnalyzer.MODEL_FILE_NAME + ".part")
            _gemmaState.value = GemmaState.Importing(0, 0)
            gemma?.close(); gemma = null
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val total = ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                        if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L
                    } ?: 0L
                    val free = dir.usableSpace
                    if (total > 0 && free < total + 200L * 1024 * 1024) {
                        error("Not enough free storage: need ${total / 1_000_000} MB, have ${free / 1_000_000} MB")
                    }
                    ctx.contentResolver.openInputStream(uri)?.use { input ->
                        tmp.outputStream().use { out ->
                            val buf = ByteArray(1 shl 20)
                            var copied = 0L
                            var lastReport = 0L
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                copied += n
                                if (copied - lastReport > 8L * 1024 * 1024) {
                                    lastReport = copied
                                    _gemmaState.value = GemmaState.Importing(copied, total)
                                }
                            }
                        }
                    } ?: error("Could not open that file")
                    if (tmp.length() < 100L * 1024 * 1024) error("That file is too small to be a Gemma model")
                    target.delete()
                    if (!tmp.renameTo(target)) error("Could not move the model into place")
                    target
                }
            }
            result.onSuccess { f ->
                settings.saveGemmaModelPath(f.absolutePath)
                _gemmaState.value = GemmaState.Ready(f.absolutePath, f.length())
            }.onFailure { e ->
                tmp.delete()
                _gemmaState.value = GemmaState.Error(e.message ?: "Import failed")
            }
        }
    }

    fun removeGemmaModel() {
        viewModelScope.launch {
            gemma?.close(); gemma = null
            val path = settings.state.value.gemmaModelPath
            settings.saveGemmaModelPath(null)
            _gemmaState.value = GemmaState.None
            if (path != null) withContext(Dispatchers.IO) { File(path).delete() }
        }
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

    fun selectDay(dayStartMillis: Long) {
        if (dayStartMillis <= startOfToday()) _selectedDay.value = dayStartMillis
    }

    fun startNewMeal() {
        _draft.value = DraftState()
        _screen.value = Screen.AddMeal
    }

    fun setDescription(text: String) = _draft.update { it.copy(description = text, error = null) }

    fun setPortionMultiplier(m: Float) = _draft.update { it.copy(portionMultiplier = m) }

    fun clearPhoto() = _draft.update { it.copy(bitmap = null, jpeg = null, uri = null) }

    fun setPhoto(uri: Uri) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val bmp = ImageUtils.loadScaled(getApplication(), uri)
                    bmp to ImageUtils.toJpeg(bmp)
                }
            }
            result.onSuccess { (bmp, jpeg) ->
                _draft.update { it.copy(bitmap = bmp, jpeg = jpeg, uri = uri, error = null) }
            }.onFailure { e ->
                _draft.update { it.copy(error = e.message ?: "Could not read that image") }
            }
        }
    }

    fun analyze() {
        val d = _draft.value
        if (d.analyzing) return
        _draft.update { it.copy(analyzing = true, error = null, stage = "Looking at it…") }
        viewModelScope.launch {
            try {
                val raw = when (activeEngine()) {
                    Engine.NANO -> analyzer.analyze(d.bitmap, d.description.ifBlank { null })
                    Engine.GEMMA -> {
                        val path = (gemmaState.value as GemmaState.Ready).path
                        val g = gemma?.takeIf { it.modelPathMatches(path) } ?: GemmaMealAnalyzer(getApplication(), path).also {
                            gemma?.close()
                            gemma = it
                        }
                        g.analyze(d.bitmap, d.description.ifBlank { null })
                    }
                    Engine.NONE -> throw AnalysisException(
                        "No on-device model is ready. Wait for Gemini Nano, or import a Gemma 3n model file in Settings."
                    )
                }
                // Packaged products: swap the model's guess for the real label numbers.
                _draft.update { it.copy(stage = "Checking labels…") }
                val hiRes = d.uri?.let { uri ->
                    withContext(Dispatchers.IO) { runCatching { ImageUtils.loadScaled(getApplication(), uri, 2048) }.getOrNull() }
                } ?: d.bitmap
                val analysis = runCatching { lookup.enrich(raw, hiRes) }.getOrDefault(raw)
                _draft.update { it.copy(analyzing = false, stage = "", analysis = analysis, portionMultiplier = 1f) }
                _screen.value = Screen.Result
            } catch (e: AnalysisException) {
                _draft.update { it.copy(analyzing = false, stage = "", error = e.message) }
            } catch (e: Exception) {
                _draft.update { it.copy(analyzing = false, stage = "", error = "Something went wrong: ${e.message}") }
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
        settings.saveGoal(goal)
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
