package com.rycalories.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

object ImageUtils {
    /** Longest edge Claude sees. Larger images are downscaled server-side anyway. */
    private const val MAX_EDGE = 1568

    /** Decode a content Uri to a right-side-up bitmap no larger than [MAX_EDGE] on its longest edge. */
    fun loadScaled(context: Context, uri: Uri): Bitmap? {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
        var sample = 1
        var w = bounds.outWidth
        var h = bounds.outHeight
        while (maxOf(w, h) / 2 >= MAX_EDGE) {
            sample *= 2
            w /= 2
            h /= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null

        val rotation = resolver.openInputStream(uri)?.use { stream ->
            when (ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } ?: 0f

        val upright = if (rotation != 0f) {
            val m = Matrix().apply { postRotate(rotation) }
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
        } else decoded

        val longest = maxOf(upright.width, upright.height)
        return if (longest > MAX_EDGE) {
            val scale = MAX_EDGE.toFloat() / longest
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
