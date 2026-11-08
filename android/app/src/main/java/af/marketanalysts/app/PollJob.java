package af.marketanalysts.app;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Periodic background check (Android minimum: every 15 minutes, survives reboot). */
public class PollJob extends JobService {
    @Override public boolean onStartJob(JobParameters p) {
        new Thread(() -> { boolean ok = Notifier.poll(this); jobFinished(p, !ok); }).start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters p) { return true; }
}
