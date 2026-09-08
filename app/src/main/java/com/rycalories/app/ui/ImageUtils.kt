package com.rycalories.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

object ImageUtils {
    private const val TAG = "ImageUtils"
    /** Longest edge handed to the on-device model. Keeps memory and inference time sane. */
    private const val MAX_EDGE = 1024

    /**
     * Decode a content Uri to a right-side-up software bitmap no larger than [MAX_EDGE] on its
     * longest edge. ImageDecoder handles HEIF (Samsung's default camera format), WebP and EXIF
     * rotation; the BitmapFactory path is kept as a fallback for anything it chokes on.
     */
    fun loadScaled(context: Context, uri: Uri, maxEdge: Int = MAX_EDGE): Bitmap {
        val modern = runCatching { decodeModern(context, uri, maxEdge) }
        modern.getOrNull()?.let { return it }
        Log.w(TAG, "ImageDecoder failed for $uri, falling back", modern.exceptionOrNull())
        return decodeLegacy(context, uri, maxEdge)
            ?: throw IllegalStateException(
                "Couldn't decode that image (${modern.exceptionOrNull()?.message ?: "unknown format"})"
            )
    }

    private fun decodeModern(context: Context, uri: Uri, maxEdge: Int): Bitmap {
        val source = ImageDecoder.createSource(context.contentResolver, uri)
        return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            // Software allocation: hardware bitmaps can't be compressed to JPEG or read back.
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.isMutableRequired = false
            val w = info.size.width
            val h = info.size.height
            val longest = maxOf(w, h)
            if (longest > maxEdge) {
                val scale = maxEdge.toFloat() / longest
                decoder.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
            }
        }
    }

    private fun decodeLegacy(context: Context, uri: Uri, maxEdge: Int): Bitmap? {
        val resolver = context.contentResolver
        // With inJustDecodeBounds the decode call returns null on purpose; only the
        // measured size tells us whether the image was readable.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val stream = resolver.openInputStream(uri) ?: return null
        stream.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        var w = bounds.outWidth
        var h = bounds.outHeight
        while (maxOf(w, h) / 2 >= maxEdge) {
            sample *= 2
            w /= 2
            h /= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null

        val rotation = runCatching {
            resolver.openInputStream(uri)?.use { stream ->
                when (ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            }
        }.getOrNull() ?: 0f

        val upright = if (rotation != 0f) {
            val m = Matrix().apply { postRotate(rotation) }
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
        } else decoded

        val longest = maxOf(upright.width, upright.height)
        return if (longest > maxEdge) {
            val scale = maxEdge.toFloat() / longest
            Bitmap.createScaledBitmap(
                upright,
                (upright.width * scale).toInt().coerceAtLeast(1),
                (upright.height * scale).toInt().coerceAtLeast(1),
                true,
            )
        } else upright
    }

    fun toJpeg(bitmap: Bitmap, quality: Int = 85): ByteArray =
        ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            out.toByteArray()
        }

    fun saveJpeg(bytes: ByteArray, dir: File, id: String): File {
        val f = File(dir, "$id.jpg")
        FileOutputStream(f).use { it.write(bytes) }
        return f
    }

    fun loadFile(path: String, maxEdge: Int = 800): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth <= 0) return null
        var sample = 1
        var w = bounds.outWidth
        var h = bounds.outHeight
        while (maxOf(w, h) / 2 >= maxEdge) {
            sample *= 2
            w /= 2
            h /= 2
        }
        return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}
