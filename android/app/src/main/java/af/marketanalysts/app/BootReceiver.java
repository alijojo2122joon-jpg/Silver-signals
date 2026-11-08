package af.marketanalysts.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        Notifier.schedule(c);
        if (Notifier.prefs(c).getBoolean("fast", false) && Notifier.prefs(c).getString("token", null) != null) {
            try { if (android.os.Build.VERSION.SDK_INT >= 26) c.startForegroundService(new Intent(c, FastService.class)); else c.startService(new Intent(c, FastService.class)); } catch (Exception ignored) {}
        }
    }
}
