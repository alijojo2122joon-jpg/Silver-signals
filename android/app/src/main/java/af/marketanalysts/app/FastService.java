package af.marketanalysts.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/** Optional "fast" mode: checks every minute while running as a quiet foreground service. */
public class FastService extends Service {
    private volatile boolean run = false;
    private Thread th;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.channels(this);
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, Notifier.CH_FG) : new Notification.Builder(this);
        Notification n = b.setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Market Analysts").setContentText("اعلان فوری سیگنال‌ها و هشدارها فعال است").setContentIntent(pi).setOngoing(true).build();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(77, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(77, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (!run) { run = true; th = new Thread(() -> { while (run) { Notifier.poll(this); try { Thread.sleep(60_000); } catch (InterruptedException ie) { break; } } }); th.start(); }
        return START_STICKY;
    }
    @Override public void onDestroy() { run = false; if (th != null) th.interrupt(); super.onDestroy(); }
    @Override public IBinder onBind(Intent i) { return null; }
}
