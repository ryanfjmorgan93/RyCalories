package com.rycalories.iron;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
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
import com.google.mlkit.genai.prompt.Candidate;
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.GenerativeModel;
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
 */
@CapacitorPlugin(name = "Nano")
public class NanoPlugin extends Plugin {

    private static final String AICORE_PACKAGE = "com.google.android.aicore";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private GenerativeModelFutures model;

    private synchronized GenerativeModelFutures ensureModel() {
        if (model == null) {
            GenerativeModel client = Generation.INSTANCE.getClient();
            model = GenerativeModelFutures.from(client);
        }
        return model;
    }

    @PluginMethod
    public void status(PluginCall call) {
        ListenableFuture<Integer> future = ensureModel().checkStatus();
        future.addListener(() -> {
            try {
                int status = future.get();
                JSObject result = new JSObject();
                result.put("state", stateName(status));
                result.put("detail", buildDetail(status));
                call.resolve(result);
            } catch (Exception e) {
                rejectWith(call, "status_failed", e);
            }
        }, executor);
    }

    @PluginMethod
    public void download(PluginCall call) {
        // Remembers the size announced by onDownloadStarted so every later event can still report
        // a total; ML Kit only gives it to us once.
        final AtomicLong totalBytes = new AtomicLong(-1);
        ensureModel().download(new DownloadCallback() {
            @Override
            public void onDownloadStarted(long bytesToDownload) {
                totalBytes.set(bytesToDownload);
                emitDownload("started", 0, bytesToDownload, null);
            }

            @Override
            public void onDownloadProgress(long totalBytesDownloaded) {
                emitDownload("progress", totalBytesDownloaded, totalBytes.get(), null);
            }

            @Override
            public void onDownloadCompleted() {
                long total = totalBytes.get();
                emitDownload("completed", total, total, null);
            }

            @Override
            public void onDownloadFailed(GenAiException e) {
                emitDownload("failed", -1, totalBytes.get(), String.valueOf(e.getMessage()));
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

        ListenableFuture<GenerateContentResponse> future = ensureModel().generateContent(builder.build());
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

    @Override
    protected void handleOnDestroy() {
        if (model != null) {
            model.getGenerativeModel().close();
        }
        executor.shutdown();
    }

    private void emitDownload(String phase, long downloaded, long total, String error) {
        JSObject data = new JSObject();
        data.put("phase", phase);
        data.put("downloaded", downloaded);
        data.put("total", total);
        if (error != null) data.put("error", error);
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

    /** FeatureStatus name plus the device/AICore diagnostics the plan asks for. */
    private String buildDetail(int status) {
        return featureStatusName(status)
            + " · " + Build.MANUFACTURER + " " + Build.MODEL
            + " · SDK " + Build.VERSION.SDK_INT
            + " · AICore " + aiCoreVersion();
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

    /** Unwraps the ExecutionException future.get() throws so the reject message names the real cause. */
    private static void rejectWith(PluginCall call, String code, Throwable t) {
        Throwable cause = (t instanceof ExecutionException && t.getCause() != null) ? t.getCause() : t;
        call.reject(code + ": " + cause.getMessage());
    }
}
