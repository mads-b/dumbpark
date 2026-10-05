package no.dumbpark.app;

final class ArrivalCheckPolicy {
    static final long MAX_DELAY_MILLIS = 20 * 60 * 1000;
    private ArrivalCheckPolicy() {}

    static boolean fresh(long triggeredAt, long now) {
        return triggeredAt > 0 && now >= triggeredAt && now - triggeredAt <= MAX_DELAY_MILLIS;
    }

    static boolean retry(long triggeredAt, long now, int attempts) {
        return fresh(triggeredAt, now) && attempts < 3;
    }
}
