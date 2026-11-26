#!/usr/bin/env bash
set -euo pipefail

app="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
signing_dir="${MIRROR_ISLE_ANDROID_SIGNING_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mirror-isle-android-signing}"
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$sdk" ]]; then
  echo "请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT" >&2
  exit 1
fi
tools="$sdk/build-tools/35.0.0"
for tool in zipalign apksigner aapt; do
  test -x "$tools/$tool"
done
keystore="$signing_dir/preview.p12"
password="$signing_dir/preview.pass"
test -r "$keystore" && test -r "$password" || { echo "找不到固定的 Android 预览签名密钥" >&2; exit 1; }
if [[ -n "${JAVA_HOME:-}" ]]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
cert="$(cat "$app/preview-cert.sha256")"
actual_cert="$(keytool -exportcert -alias mirror-isle-preview -keystore "$keystore" \
  -storepass:file "$password" | sha256sum | cut -d' ' -f1)"
[[ "$actual_cert" == "$cert" ]] || { echo "预览签名证书与发布渠道不匹配" >&2; exit 1; }

version="$(sed -n 's/^versionName=//p' "$app/version.properties")"
code="$(sed -n 's/^versionCode=//p' "$app/version.properties")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?-alpha\.[0-9]+$ && "$code" =~ ^[1-9][0-9]*$ ]] ||
  { echo "Android 预览版本格式错误: $version ($code)" >&2; exit 1; }

(cd "$app/android" && bash ./gradlew :app:assembleRelease --no-daemon "$@")

unsigned="$app/android/app/build/outputs/apk/release/app-release-unsigned.apk"
test -s "$unsigned"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
apk="$temp/Pix-Scripting-Android.apk"
"$tools/zipalign" -f -P 16 4 "$unsigned" "$temp/aligned.apk"
"$tools/apksigner" sign --ks "$keystore" --ks-key-alias mirror-isle-preview \
  --ks-pass "file:$password" --v4-signing-enabled false --out "$apk" "$temp/aligned.apk"
signed_cert="$("$tools/apksigner" verify --print-certs "$apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
[[ "$signed_cert" == "$cert" ]]
"$tools/zipalign" -c -P 16 4 "$apk"
unzip -tq "$apk"
test "$(unzip -p "$apk" assets/index.android.bundle | wc -c)" -gt 1000
metadata="$("$tools/aapt" dump badging "$apk")"
[[ "$metadata" == *"name='com.pixscripting.preview' versionCode='$code' versionName='$version'"* ]]
if [[ "$metadata" == *"application-debuggable"* ]]; then
  echo "预览 APK 意外开启了调试模式" >&2
  exit 1
fi
dest="$app/dist/android-v$version"
mkdir -p "$dest"
install -m 0644 "$apk" "$dest/"
(cd "$dest" && sha256sum Pix-Scripting-Android.apk > SHA256SUMS && sha256sum -c SHA256SUMS)
printf 'Pix-Scripting Android 预览 APK %s (%s)\n%s\n' "$version" "$code" "$dest/Pix-Scripting-Android.apk"
