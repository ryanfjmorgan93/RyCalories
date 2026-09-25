package com.rycalories.iron;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.genai.common.DownloadCallback;
import com.google.mlkit.genai.common.FeatureStatus;
import com.google.mlkit.genai.common.GenAiException;
import com.google.mlkit.genai.common.StreamingCallback;
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.CountTokensResponse;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.GenerationConfig;
import com.google.mlkit.genai.prompt.GenerativeModel;
import com.google.mlkit.genai.prompt.ImagePart;
import com.google.mlkit.genai.prompt.ModelConfig;
import com.google.mlkit.genai.prompt.ModelPreference;
import com.google.mlkit.genai.prompt.SystemInstruction;
import com.google.mlkit.genai.prompt.TextPart;
import com.google.mlkit.genai.prompt.java.GenerativeModelFutures;

import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * On-device Gemini Nano access via ML Kit GenAI Prompt API (AICore).
 *
 * Threading: every {@code @PluginMethod} is invoked by Capacitor on its single shared plugin
 * thread, so none of them may block it. The ML Kit calls below all return a Guava
 * {@link ListenableFuture}; each future gets a listener registered on {@link #executor}, a
 * single-thread pool owned by this plugin, so the wait for AICore happens off the bridge thread
 * and {@code call.resolve}/{@code call.reject} run once the future is already done (get() then
 * returns immediately). Nothing here ever calls {@code future.get()} from the bridge thread.
 *
 * Two clients are built lazily and cached: {@link #ensureModel()} is the existing default client
 * (unchanged), and {@link #ensureFullModel()} asks ML Kit for the FULL {@link ModelPreference}
 * instead. Every {@code @PluginMethod} reads an optional string {@code model} from the call —
 * {@code "full"} selects the full client, anything else or a missing value selects the default
 * one — via {@link #modelFor(PluginCall)}. {@link #generateStream} streams chunks back as they
 * arrive through {@code notifyListeners("nanoStream", …)}, on the same executor listener as every
 * other completion; nothing waits on the stream from the bridge thread either.
 */
@CapacitorPlugin(name = "Nano")
public class NanoPlugin extends Plugin {

    private static final String AICORE_PACKAGE = "com.google.android.aicore";

    /**
     * Longest edge a decoded meal photo is downsampled to before it goes to the model. 1,024 px is
     * a starting value chosen to stay comfortably under the API's ~4,000-token input budget; it is
     * not a documented ML Kit limit, so it may need tuning once real photos are tried on-device.
     */
    private static final int MEAL_MAX_EDGE = 1024;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private GenerativeModelFutures model;
    private GenerativeModelFutures fullModel;

    private synchronized GenerativeModelFutures ensureModel() {
        if (model == null) {
            GenerativeModel client = Generation.INSTANCE.getClient();
            model = GenerativeModelFutures.from(client);
        }
        return model;
    }

    /** Same as {@link #ensureModel()} but built with {@link ModelPreference#FULL}. */
    private synchronized GenerativeModelFutures ensureFullModel() {
        if (fullModel == null) {
            ModelConfig.Builder modelConfig = new ModelConfig.Builder();
            modelConfig.setPreference(ModelPreference.FULL);
            GenerationConfig.Builder generationConfig = new GenerationConfig.Builder();
            generationConfig.setModelConfig(modelConfig.build());
            GenerativeModel client = Generation.INSTANCE.getClient(generationConfig.build());
            fullModel = GenerativeModelFutures.from(client);
        }
        return fullModel;
    }

    /** {@code "full"} when the call asked for the full model, {@code "default"} otherwise. */
    private static String modelName(PluginCall call) {
        return "full".equals(call.getString("model")) ? "full" : "default";
    }

    /** Resolves the call's optional {@code model} string to the matching cached client. */
    private GenerativeModelFutures modelFor(PluginCall call) {
        return "full".equals(modelName(call)) ? ensureFullModel() : ensureModel();
    }

    @PluginMethod
    public void status(PluginCall call) {
        GenerativeModelFutures target = modelFor(call);
        ListenableFuture<Integer> future = target.checkStatus();
        future.addListener(() -> {
            try {
                int status = future.get();
                readDetailExtras(call, target, status);
            } catch (Exception e) {
                rejectWith(call, "status_failed", e);
            }
        }, executor);
    }

    /**
     * Chains {@code getBaseModelName()} then {@code getTokenLimit()} on {@link #executor}, off
     * the back of a resolved {@code checkStatus()}, and resolves {@code call} once both have
     * either come back or failed. Neither read blocks the other's listener, and a failure on
     * either (e.g. the model is not downloaded yet) just leaves that part out of the detail
     * string rather than failing the status call.
     */
    private void readDetailExtras(PluginCall call, GenerativeModelFutures target, int status) {
        // Only an installed model has a name and a limit to read. Asked before then, a future that
        // never completed would leave the status call — and the Settings card — waiting for ever.
        if (status != FeatureStatus.AVAILABLE) {
            JSObject result = new JSObject();
            result.put("state", stateName(status));
            result.put("detail", buildDetail(status, null, null));
            call.resolve(result);
            return;
        }
        ListenableFuture<String> nameFuture = target.getBaseModelName();
        nameFuture.addListener(() -> {
            String baseModelName;
            try {
                baseModelName = nameFuture.get();
            } catch (Exception e) {
                baseModelName = null;
            }
            final String resolvedName = baseModelName;

            ListenableFuture<Integer> limitFuture = target.getTokenLimit();
            limitFuture.addListener(() -> {
                Integer tokenLimit;
                try {
                    tokenLimit = limitFuture.get();
                } catch (Exception e) {
                    tokenLimit = null;
                }
                JSObject result = new JSObject();
                result.put("state", stateName(status));
                result.put("detail", buildDetail(status, resolvedName, tokenLimit));
                call.resolve(result);
            }, executor);
        }, executor);
    }

    @PluginMethod
    public void download(PluginCall call) {
        // Remembers the size announced by onDownloadStarted so every later event can still report
        // a total; ML Kit only gives it to us once.
        final AtomicLong totalBytes = new AtomicLong(-1);
        final String modelName = modelName(call);
        modelFor(call).download(new DownloadCallback() {
            @Override
            public void onDownloadStarted(long bytesToDownload) {
                totalBytes.set(bytesToDownload);
                emitDownload("started", 0, bytesToDownload, null, modelName);
            }

            @Override
            public void onDownloadProgress(long totalBytesDownloaded) {
                emitDownload("progress", totalBytesDownloaded, totalBytes.get(), null, modelName);
            }

            @Override
            public void onDownloadCompleted() {
                long total = totalBytes.get();
                emitDownload("completed", total, total, null, modelName);
            }

            @Override
            public void onDownloadFailed(GenAiException e) {
                emitDownload("failed", -1, totalBytes.get(), String.valueOf(e.getMessage()), modelName);
            }
        });
        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("bad_request: prompt is required");
            return;
        }
        String system = call.getString("system", "");
        Integer maxOutputTokens = call.getInt("maxOutputTokens");
        Float temperature = call.getFloat("temperature");

        GenerateContentRequest.Builder builder = new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(prompt));
        if (maxOutputTokens != null) builder.setMaxOutputTokens(maxOutputTokens);
        if (temperature != null) builder.setTemperature(temperature);

        ListenableFuture<GenerateContentResponse> future = modelFor(call).generateContent(builder.build());
        future.addListener(() -> {
            try {
                GenerateContentResponse response = future.get();
                List<Candidate> candidates = response.getCandidates();
                String text = candidates.isEmpty() ? null : candidates.get(0).getText();
                if (text == null || text.isEmpty()) {
                    call.reject("empty: no candidate text returned");
                    return;
                }
                JSObject result = new JSObject();
                result.put("text", text);
                call.resolve(result);
            } catch (Exception e) {
                rejectWith(call, "generate_failed", e);
            }
        }, executor);
    }

    /**
     * Counts the tokens {@code system}/{@code prompt} would cost, built the same way
     * {@link #generate} builds its request, alongside the selected client's current token
     * limit. Both reads run through ML Kit futures, never blocking the bridge thread.
     */
    @PluginMethod
    public void countTokens(PluginCall call) {
        String prompt = call.getString("prompt");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("bad_request: prompt is required");
            return;
        }
        String system = call.getString("system", "");
        GenerativeModelFutures target = modelFor(call);

        GenerateContentRequest request = new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(prompt)).build();

        ListenableFuture<CountTokensResponse> tokensFuture = target.countTokens(request);
        tokensFuture.addListener(() -> {
            try {
                int tokens = tokensFuture.get().getTotalTokens();
                ListenableFuture<Integer> limitFuture = target.getTokenLimit();
                limitFuture.addListener(() -> {
                    try {
                        int limit = limitFuture.get();
                        JSObject result = new JSObject();
                        result.put("tokens", tokens);
                        result.put("limit", limit);
                        call.resolve(result);
                    } catch (Exception e) {
                        rejectWith(call, "count_tokens_failed", e);
                    }
                }, executor);
            } catch (Exception e) {
                rejectWith(call, "count_tokens_failed", e);
            }
        }, executor);
    }

    /**
     * Same request shape as {@link #generate}, but streamed: every chunk ML Kit hands to
     * {@link StreamingCallback#onNewText} is forwarded immediately as a {@code nanoStream} event
     * carrying the call's {@code requestId}, so the UI can render it as it arrives.
     * {@code onNewThought} chunks are dropped — this plugin only ever surfaces the answer, never
     * the model's reasoning. Once the future completes, {@code call} resolves with the first
     * candidate's text, falling back to the streamed chunks concatenated if the response itself
     * carried none.
     */
    @PluginMethod
    public void generateStream(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null || requestId.isEmpty()) {
            call.reject("bad_request: requestId is required");
            return;
        }
        String prompt = call.getString("prompt");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("bad_request: prompt is required");
            return;
        }
        String system = call.getString("system", "");
        Integer maxOutputTokens = call.getInt("maxOutputTokens");
        Float temperature = call.getFloat("temperature");

        GenerateContentRequest.Builder builder = new GenerateContentRequest.Builder(new SystemInstruction(system), new TextPart(prompt));
        if (maxOutputTokens != null) builder.setMaxOutputTokens(maxOutputTokens);
        if (temperature != null) builder.setTemperature(temperature);

        // Collected purely as a fallback for the final resolve, in case the response carries no
        // candidate text of its own once streaming finishes.
        final StringBuilder streamed = new StringBuilder();
        StreamingCallback callback = new StreamingCallback() {
            @Override
            public void onNewText(String chunk) {
                streamed.append(chunk);
                JSObject data = new JSObject();
                data.put("requestId", requestId);
                data.put("text", chunk);
                notifyListeners("nanoStream", data);
            }
        };

        ListenableFuture<GenerateContentResponse> future = modelFor(call).generateContent(builder.build(), callback);
        future.addListener(() -> {
            try {
                GenerateContentResponse response = future.get();
                List<Candidate> candidates = response.getCandidates();
                String text = candidates.isEmpty() ? null : candidates.get(0).getText();
                if ((text == null || text.isEmpty()) && streamed.length() > 0) {
                    text = streamed.toString();
                }
                if (text == null || text.isEmpty()) {
                    call.reject("empty: no candidate text returned");
                    return;
                }
                JSObject result = new JSObject();
                result.put("text", text);
                call.resolve(result);
            } catch (Exception e) {
                rejectWith(call, "generate_stream_failed", e);
            }
        }, executor);
    }

    /**
     * Names an ingredient photo, on-device: decodes the file at {@code path}, downsamples it to
     * {@link #MEAL_MAX_EDGE} and sends it to Nano alongside {@code prompt}/{@code system}, the same
     * way {@link #generate} does for text. Decoding is blocking IO+CPU, so it runs on
     * {@link #executor}, never on the Capacitor bridge thread. Inference itself is NOT waited on
     * there: {@link #executor} is single-threaded and every other method's completion runs on it,
     * so blocking it on {@code get()} for the length of an inference — or for ever, if one never
     * returns — would stall status checks and every assistant answer behind it. The result is
     * handed back through a listener instead, exactly as {@link #generate} does.
     */
    @PluginMethod
    public void analyzeMeal(PluginCall call) {
        executor.execute(() -> {
            Bitmap bitmap = null;
            // Set once the bitmap has been handed to the inference future; from then on the
            // listener owns it and recycles it, and the finally below must not.
            boolean handedOff = false;
            try {
                String path = call.getString("path");
                if (path == null || path.isEmpty()) {
                    call.reject("bad_request: path is required");
                    return;
                }
                String prompt = call.getString("prompt");
                if (prompt == null || prompt.isEmpty()) {
                    call.reject("bad_request: prompt is required");
                    return;
                }
                String system = call.getString("system", "");
                Integer maxOutputTokens = call.getInt("maxOutputTokens");
                Float temperature = call.getFloat("temperature");

                // Handles both file:// URIs and plain filesystem paths, and decodes any
                // percent-encoding (e.g. spaces) the caller's URI may carry.
                String filePath = Uri.parse(path).getPath();
                if (filePath == null || filePath.isEmpty()) {
                    call.reject("bad_request: path is required");
                    return;
                }

                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeFile(filePath, bounds);
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                    call.reject("decode_failed: could not read image");
                    return;
                }

                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, MEAL_MAX_EDGE);
                bitmap = BitmapFactory.decodeFile(filePath, options);
                if (bitmap == null) {
                    call.reject("decode_failed: could not decode image");
                    return;
                }

                GenerateContentRequest.Builder builder =
                    new GenerateContentRequest.Builder(new SystemInstruction(system), new ImagePart(bitmap), new TextPart(prompt));
                if (maxOutputTokens != null) builder.setMaxOutputTokens(maxOutputTokens);
                if (temperature != null) builder.setTemperature(temperature);

                ListenableFuture<GenerateContentResponse> future = modelFor(call).generateContent(builder.build());
                final Bitmap sent = bitmap;
                handedOff = true;
                future.addListener(() -> {
                    try {
                        GenerateContentResponse response = future.get();
                        List<Candidate> candidates = response.getCandidates();
                        String text = candidates.isEmpty() ? null : candidates.get(0).getText();
                        if (text == null || text.isEmpty()) {
                            call.reject("empty: no candidate text returned");
                            return;
                        }
                        JSObject result = new JSObject();
                        result.put("text", text);
                        call.resolve(result);
                    } catch (Throwable t) {
                        rejectWith(call, "analyze_failed", t);
                    } finally {
                        // Recycled only once inference has finished with it, success or failure.
                        sent.recycle();
                    }
                }, executor);
            } catch (Throwable t) {
                // Throwable, not Exception: an OutOfMemoryError decoding a large photo must still
                // reject the call rather than leaving the JS promise hanging forever.
                rejectWith(call, "analyze_failed", t);
            } finally {
                if (bitmap != null && !handedOff) bitmap.recycle();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (model != null) {
            model.getGenerativeModel().close();
        }
        if (fullModel != null) {
            fullModel.getGenerativeModel().close();
        }
        executor.shutdown();
    }

    private void emitDownload(String phase, long downloaded, long total, String error, String modelName) {
        JSObject data = new JSObject();
        data.put("phase", phase);
        data.put("downloaded", downloaded);
        data.put("total", total);
        if (error != null) data.put("error", error);
        data.put("model", modelName);
        notifyListeners("nanoDownload", data);
    }

    private static String stateName(int status) {
        switch (status) {
            case FeatureStatus.AVAILABLE:
                return "ready";
            case FeatureStatus.DOWNLOADABLE:
                return "downloadable";
            case FeatureStatus.DOWNLOADING:
                return "downloading";
            case FeatureStatus.UNAVAILABLE:
            default:
                return "unavailable";
        }
    }

    private static String featureStatusName(int status) {
        switch (status) {
            case FeatureStatus.AVAILABLE:
                return "AVAILABLE";
            case FeatureStatus.DOWNLOADABLE:
                return "DOWNLOADABLE";
            case FeatureStatus.DOWNLOADING:
                return "DOWNLOADING";
            case FeatureStatus.UNAVAILABLE:
            default:
                return "UNAVAILABLE";
        }
    }

    /**
     * FeatureStatus name, the base model name and token limit when they could be read, and the
     * device/AICore diagnostics — in that order, each segment joined by " · ". A null
     * {@code baseModelName} or {@code tokenLimit} simply drops its segment.
     */
    private String buildDetail(int status, String baseModelName, Integer tokenLimit) {
        StringBuilder detail = new StringBuilder(featureStatusName(status));
        if (baseModelName != null && !baseModelName.isEmpty()) {
            detail.append(" · ").append(baseModelName);
        }
        if (tokenLimit != null) {
            detail.append(" · ").append(tokenLimit).append(" tokens");
        }
        detail.append(" · ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL)
            .append(" · SDK ").append(Build.VERSION.SDK_INT)
            .append(" · AICore ").append(aiCoreVersion());
        return detail.toString();
    }

    private String aiCoreVersion() {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(AICORE_PACKAGE, 0);
            if (info.versionName != null && !info.versionName.isEmpty()) return info.versionName;
            return "build " + info.getLongVersionCode();
        } catch (PackageManager.NameNotFoundException e) {
            return "not installed";
        }
    }

    /** Largest power-of-two inSampleSize that keeps the decoded image's longest edge within maxEdge. */
    private static int calculateInSampleSize(int width, int height, int maxEdge) {
        int inSampleSize = 1;
        int longestEdge = Math.max(width, height);
        while (longestEdge / inSampleSize > maxEdge) {
            inSampleSize *= 2;
        }
        return inSampleSize;
    }

    /**
     * Unwraps the ExecutionException future.get() throws so the reject message names the real
     * cause. When that cause is a {@link GenAiException}, the reject also carries
     * {@code data.genAiErrorCode} (the raw int) and {@code data.genAiError} (its
     * {@link GenAiException.ErrorCode} constant name) so the UI can show which ML Kit failure this
     * was by name rather than parsing the message text. For any other cause the reject is the
     * single-string form, unchanged from before.
     */
    private static void rejectWith(PluginCall call, String code, Throwable t) {
        Throwable cause = (t instanceof ExecutionException && t.getCause() != null) ? t.getCause() : t;
        String message = code + ": " + cause.getMessage();
        if (cause instanceof GenAiException) {
            int errorCode = ((GenAiException) cause).getErrorCode();
            JSObject data = new JSObject();
            data.put("genAiErrorCode", errorCode);
            data.put("genAiError", genAiErrorName(errorCode));
            call.reject(message, code, data);
        } else {
            call.reject(message);
        }
    }

    /** Maps a {@link GenAiException.ErrorCode} int to its constant name, for the UI to show verbatim. */
    private static String genAiErrorName(int code) {
        switch (code) {
            case GenAiException.ErrorCode.REQUEST_PROCESSING_ERROR:
                return "REQUEST_PROCESSING_ERROR";
            case GenAiException.ErrorCode.CANCELLED:
                return "CANCELLED";
            case GenAiException.ErrorCode.NOT_AVAILABLE:
                return "NOT_AVAILABLE";
            case GenAiException.ErrorCode.BUSY:
                return "BUSY";
            case GenAiException.ErrorCode.RESPONSE_PROCESSING_ERROR:
                return "RESPONSE_PROCESSING_ERROR";
            case GenAiException.ErrorCode.REQUEST_TOO_LARGE:
                return "REQUEST_TOO_LARGE";
            case GenAiException.ErrorCode.REQUEST_TOO_SMALL:
                return "REQUEST_TOO_SMALL";
            case GenAiException.ErrorCode.RESPONSE_GENERATION_ERROR:
                return "RESPONSE_GENERATION_ERROR";
            case GenAiException.ErrorCode.NOT_SUPPORTED:
                return "NOT_SUPPORTED";
            case GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED:
                return "PER_APP_BATTERY_USE_QUOTA_EXCEEDED";
            case GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED:
                return "BACKGROUND_USE_BLOCKED";
            case GenAiException.ErrorCode.NOT_ENOUGH_DISK_SPACE:
                return "NOT_ENOUGH_DISK_SPACE";
            case GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE:
                return "NEEDS_SYSTEM_UPDATE";
            case GenAiException.ErrorCode.AICORE_INCOMPATIBLE:
                return "AICORE_INCOMPATIBLE";
            case GenAiException.ErrorCode.INVALID_INPUT_IMAGE:
                return "INVALID_INPUT_IMAGE";
            case GenAiException.ErrorCode.CACHE_PROCESSING_ERROR:
                return "CACHE_PROCESSING_ERROR";
            case GenAiException.ErrorCode.STRUCTURED_OUTPUT_REQUEST_ERROR:
                return "STRUCTURED_OUTPUT_REQUEST_ERROR";
            case GenAiException.ErrorCode.STRUCTURED_OUTPUT_RESPONSE_ERROR:
                return "STRUCTURED_OUTPUT_RESPONSE_ERROR";
            case GenAiException.ErrorCode.STRUCTURED_OUTPUT_MAX_TOKENS_ERROR:
                return "STRUCTURED_OUTPUT_MAX_TOKENS_ERROR";
            case GenAiException.ErrorCode.AUDIO_BUFFER_OVERFLOW:
                return "AUDIO_BUFFER_OVERFLOW";
            case GenAiException.ErrorCode.UNKNOWN:
            default:
                return "UNKNOWN";
        }
    }
}
