package no.dumbpark.app;

import static org.junit.Assert.*;
import org.junit.Test;

public final class ArrivalCheckPolicyTest {
    private static final long ARRIVAL = 1_000_000;

    @Test public void recentArrivalCanRetryTransientFailures() {
        assertTrue(ArrivalCheckPolicy.retry(ARRIVAL, ARRIVAL + 60_000, 0));
        assertTrue(ArrivalCheckPolicy.retry(ARRIVAL, ARRIVAL + 7 * 60_000, 2));
        assertFalse(ArrivalCheckPolicy.retry(ARRIVAL, ARRIVAL + 7 * 60_000, 3));
    }

    @Test public void delayedOrMissingArrivalCannotRetryLaterInTheWorkday() {
        assertFalse(ArrivalCheckPolicy.fresh(0, ARRIVAL));
        assertFalse(ArrivalCheckPolicy.fresh(ARRIVAL, ARRIVAL - 1));
        assertTrue(ArrivalCheckPolicy.fresh(ARRIVAL, ARRIVAL + ArrivalCheckPolicy.MAX_DELAY_MILLIS));
        assertFalse(ArrivalCheckPolicy.retry(ARRIVAL, ARRIVAL + ArrivalCheckPolicy.MAX_DELAY_MILLIS + 1, 0));
    }
}
