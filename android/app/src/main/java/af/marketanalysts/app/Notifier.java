package af.marketanalysts.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/** Polls public.device_inbox with this device's private token and shows new notifications.
 *  No Firebase / Google services and no login session are used. */
public final class Notifier {
    static final String PREFS = "ma_push", CH = "ma_alerts", CH_FG = "ma_fg";
    static final String SUPA = "https://segfazxjglbawdhopnra.supabase.co";
    static final String ANON = "sb_publishable_VfSrjufay_d3__oseWrv2Q_UaCXJn5F";
    static final int JOB_ID = 4711;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel a = new NotificationChannel(CH, "سیگنال‌ها و هشدارها", NotificationManager.IMPORTANCE_HIGH);
        a.enableVibration(true); nm.createNotificationChannel(a);
        NotificationChannel f = new NotificationChannel(CH_FG, "اعلان فوری (در پس‌زمینه)", NotificationManager.IMPORTANCE_MIN);
        f.setShowBadge(false); nm.createNotificationChannel(f);
    }

    static void schedule(Context c) {
        JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null || prefs(c).getString("token", null) == null) return;
        JobInfo ji = new JobInfo.Builder(JOB_ID, new ComponentName(c, PollJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build();
        js.schedule(ji);
    }

    /** Fetch new rows and show them. Returns false on network error. */
    static boolean poll(Context c) {
        SharedPreferences p = prefs(c);
        String token = p.getString("token", null); if (token == null) return true;
        long after = p.getLong("after", 0);
        try {
            java.net.HttpURLConnection h = (java.net.HttpURLConnection) new java.net.URL(SUPA + "/rest/v1/rpc/device_inbox").openConnection();
            h.setConnectTimeout(10000); h.setReadTimeout(10000); h.setRequestMethod("POST"); h.setDoOutput(true);
            h.setRequestProperty("apikey", ANON); h.setRequestProperty("Authorization", "Bearer " + ANON); h.setRequestProperty("Content-Type", "application/json");
            org.json.JSONObject body = new org.json.JSONObject(); body.put("p_token", token); body.put("p_after", after);
            try (java.io.OutputStream os = h.getOutputStream()) { os.write(body.toString().getBytes("UTF-8")); }
            if (h.getResponseCode() != 200) return false;
            java.io.InputStream in = h.getInputStream(); java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            org.json.JSONArray arr = new org.json.JSONArray(bo.toString("UTF-8"));
            long max = after;
            for (int i = arr.length() - 1; i >= 0; i--) {                 // oldest first
                org.json.JSONObject o = arr.getJSONObject(i); long id = o.getLong("id");
                if (id <= after) continue; max = Math.max(max, id);
                if (after > 0) show(c, (int) (id % 100000), o.optString("title"), o.optString("body"), o.optString("kind"));
            }
            if (max != after) p.edit().putLong("after", max).apply();   // first run only records the position
            return true;
        } catch (Exception e) { return false; }
    }

    static void show(Context c, int id, String title, String body, String kind) {
        channels(c);
        String path = "chat".equals(kind) ? "?chat=1" : "signal".equals(kind) ? "?pg=sig" : "?notifs=1";
        Intent i = new Intent(c, MainActivity.class).putExtra("path", path).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH) : new Notification.Builder(c);
        b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true).setContentIntent(pi).setDefaults(Notification.DEFAULT_ALL);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH);
        try { ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(id, b.build()); } catch (Exception ignored) {}
    }
}
