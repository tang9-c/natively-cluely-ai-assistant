use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioDropSnapshot {
    pub dropped_samples: u64,
    pub drop_events: u64,
}

#[derive(Debug, Default)]
pub(crate) struct AudioDropStats {
    dropped_samples: AtomicU64,
    drop_events: AtomicU64,
}

impl AudioDropStats {
    #[inline]
    pub fn record_write(&self, requested: usize, written: usize) {
        let dropped = requested.saturating_sub(written) as u64;
        if dropped == 0 {
            return;
        }

        saturating_add(&self.dropped_samples, dropped);
        saturating_add(&self.drop_events, 1);
    }

    pub fn snapshot(&self) -> AudioDropSnapshot {
        AudioDropSnapshot {
            dropped_samples: self.dropped_samples.load(Ordering::Relaxed),
            drop_events: self.drop_events.load(Ordering::Relaxed),
        }
    }

    pub fn reset(&self) {
        self.dropped_samples.store(0, Ordering::Relaxed);
        self.drop_events.store(0, Ordering::Relaxed);
    }
}

#[inline]
fn saturating_add(value: &AtomicU64, increment: u64) {
    let _ = value.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        Some(current.saturating_add(increment))
    });
}

#[cfg(test)]
mod tests {
    use super::AudioDropStats;

    #[test]
    fn records_dropped_samples_and_events() {
        let stats = AudioDropStats::default();

        stats.record_write(320, 300);
        stats.record_write(320, 320);
        stats.record_write(320, 280);

        let snapshot = stats.snapshot();
        assert_eq!(snapshot.dropped_samples, 60);
        assert_eq!(snapshot.drop_events, 2);
    }

    #[test]
    fn reset_starts_a_fresh_capture_session() {
        let stats = AudioDropStats::default();
        stats.record_write(320, 300);

        stats.reset();

        let snapshot = stats.snapshot();
        assert_eq!(snapshot.dropped_samples, 0);
        assert_eq!(snapshot.drop_events, 0);
    }
}
