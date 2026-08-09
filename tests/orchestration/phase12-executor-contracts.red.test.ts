// Phase 12 is intentionally attached to the existing orchestration CI gate for
// the fail-first cycle. A dedicated executor CI step may be introduced only
// after first GREEN without changing these behavioral tests.
import "../executors/launch-spec.red.test";
import "../executors/sqlite-omp-execution-registry.red.test";
