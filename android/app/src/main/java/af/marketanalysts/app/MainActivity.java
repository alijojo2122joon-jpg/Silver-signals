package af.marketanalysts.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebResourceError;
import android.net.ConnectivityManager;
import android.net.Network;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final int FILE_REQ = 11, MIC_REQ = 12;
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private PermissionRequest pendingPerm;

    private class Bridge {
        @android.webkit.JavascriptInterface
        public void shareImage(String b64, String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.putExtra(Intent.EXTRA_TEXT, text);
                send.setType("text/plain");
                try {
                    if (android.os.Build.VERSION.SDK_INT >= 29) {
                        byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                        android.content.ContentValues cv = new android.content.ContentValues();
                        cv.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "market-analysts-" + System.currentTimeMillis() + ".png");
                        cv.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
                        cv.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/MarketAnalysts");
                        Uri uri = getContentResolver().insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                        if (uri != null) {
                            try (java.io.OutputStream os = getContentResolver().openOutputStream(uri)) { os.write(bytes); }
                            send.setType("image/png");
                            send.putExtra(Intent.EXTRA_STREAM, uri);
                            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        }
                    }
                } catch (Exception ignored) {}
                try { startActivity(Intent.createChooser(send, null)); } catch (Exception ignored) {}
            });
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFFEEF2F0);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        web.setVisibility(View.INVISIBLE);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " MarketAnalystsApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (web.getVisibility() != View.VISIBLE) { web.setAlpha(0f); web.setVisibility(View.VISIBLE); web.animate().alpha(1f).setDuration(220).start(); }
                getWindow().setBackgroundDrawable(null);
                if (url != null && url.startsWith("file:")) view.evaluateJavascript("window.START='" + BuildConfig.START_URL + "'", null);
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    view.loadUrl("file:///android_asset/offline.html");
                    waitForNetwork();
                }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost() == null ? "" : u.getHost();
                if (host.endsWith("github.io")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    Intent i = params.createIntent();
                    String[] at = params.getAcceptTypes();
                    String acc = at != null && at.length > 0 && at[0] != null ? at[0] : "";
                    i.setType(acc.contains("video") ? "video/*" : "image/*");
                    startActivityForResult(Intent.createChooser(i, null), FILE_REQ);
                } catch (Exception e) { fileCb = null; return false; }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsMic = false;
                    for (String r : request.getResources())
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                    if (!wantsMic) { request.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingPerm = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQ);
                    }
                });
            }
        });

        s.setAllowFileAccess(true);
        if (state != null) web.restoreState(state);
        else web.loadUrl(BuildConfig.START_URL);
        checkUpdate();
    }

    private boolean waiting = false;
    private void waitForNetwork() {
        if (waiting) return; waiting = true;
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return;
        cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) {
                runOnUiThread(() -> { waiting = false; web.loadUrl(BuildConfig.START_URL); });
                try { cm.unregisterNetworkCallback(this); } catch (Exception ignored) {}
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == MIC_REQ && pendingPerm != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED)
                pendingPerm.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingPerm.deny();
            pendingPerm = null;
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        if (req == FILE_REQ && fileCb != null) {
            Uri[] r = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    r = new Uri[n];
                    for (int i = 0; i < n; i++) r[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) r = new Uri[]{data.getData()};
            }
            fileCb.onReceiveValue(r);
            fileCb = null;
            return;
        }
        super.onActivityResult(req, result, data);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    /* ===== به‌روزرسانی داخل برنامه ===== */
    private static final String REL = "https://api.github.com/repos/alijojo2122joon-jpg/Silver-signals/releases/latest";
    private long dlId = -1;
    private void checkUpdate() {
        new Thread(() -> {
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(REL).openConnection();
                c.setConnectTimeout(8000); c.setReadTimeout(8000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                if (c.getResponseCode() != 200) return;
                java.io.InputStream in = c.getInputStream();
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                org.json.JSONObject j = new org.json.JSONObject(bo.toString("UTF-8"));
                String tag = j.optString("tag_name", "");
                if (!tag.startsWith("android-v")) return;
                int latest = Integer.parseInt(tag.substring(9));
                if (latest <= BuildConfig.VERSION_CODE) return;
                org.json.JSONArray as = j.getJSONArray("assets");
                String url = null;
                for (int k = 0; k < as.length(); k++) {
                    org.json.JSONObject a = as.getJSONObject(k);
                    if (BuildConfig.APK_NAME.equals(a.optString("name"))) url = a.optString("browser_download_url");
                }
                if (url == null) return;
                final String u = url;
                runOnUiThread(() -> askUpdate(u));
            } catch (Exception ignored) {}
        }).start();
    }
    private void askUpdate(String url) {
        if (isFinishing()) return;
        new android.app.AlertDialog.Builder(this)
            .setTitle("نسخه‌ی جدید برنامه")
            .setMessage("نسخه‌ی تازه‌ی Market Analysts آماده است. همین حالا به‌روزرسانی شود؟")
            .setPositiveButton("به‌روزرسانی", (d, w) -> download(url))
            .setNegativeButton("بعداً", null)
            .show();
    }
    private void download(String url) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                android.widget.Toast.makeText(this, "برای نصب به‌روزرسانی، اجازه‌ی «نصب برنامه‌های ناشناس» را برای Market Analysts روشن کنید و برگردید.", android.widget.Toast.LENGTH_LONG).show();
                startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                pendingUrl = url;
                return;
            }
            android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            java.io.File f = new java.io.File(getExternalFilesDir(null), BuildConfig.APK_NAME);
            if (f.exists()) f.delete();
            android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(Uri.parse(url))
                .setTitle("Market Analysts")
                .setDescription("در حال دانلود نسخه‌ی جدید…")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE)
                .setDestinationInExternalFilesDir(this, null, BuildConfig.APK_NAME);
            dlId = dm.enqueue(r);
            android.widget.Toast.makeText(this, "در حال دانلود نسخه‌ی جدید…", android.widget.Toast.LENGTH_SHORT).show();
            android.content.IntentFilter fl = new android.content.IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            android.content.BroadcastReceiver rc = new android.content.BroadcastReceiver() {
                @Override public void onReceive(android.content.Context ctx, Intent i) {
                    if (i.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -2) != dlId) return;
                    try { unregisterReceiver(this); } catch (Exception ignored) {}
                    Uri apk = dm.getUriForDownloadedFile(dlId);
                    if (apk == null) { android.widget.Toast.makeText(MainActivity.this, "دانلود ناموفق بود", android.widget.Toast.LENGTH_LONG).show(); return; }
                    Intent inst = new Intent(Intent.ACTION_VIEW);
                    inst.setDataAndType(apk, "application/vnd.android.package-archive");
                    inst.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(inst); } catch (Exception ignored) {}
                }
            };
            if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(rc, fl, android.content.Context.RECEIVER_EXPORTED);
            else registerReceiver(rc, fl);
        } catch (Exception e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
        }
    }
    private String pendingUrl = null;
    @Override
    protected void onResume() {
        super.onResume();
        if (pendingUrl != null && (android.os.Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            String u = pendingUrl; pendingUrl = null; download(u);
        }
    }
}
