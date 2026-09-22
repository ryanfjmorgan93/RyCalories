/**
 * Which build is running, shown in Settings.
 *
 * Every build used to report "Iron 0.1.0". When the owner said a fix had not reached the phone,
 * there was no way to know whether the phone had the build containing it. The run number matches
 * the one Android shows in App info (android/app/build.gradle sets versionName from it).
 */
export const BUILD_LABEL = `Iron ${__APP_VERSION__} · build ${__BUILD_RUN__ || 'local'}${__BUILD_SHA__ ? ` · ${__BUILD_SHA__}` : ''}`;
