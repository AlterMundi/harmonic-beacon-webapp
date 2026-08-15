import copy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "listener_container_observer", ROOT / "scripts/listener_container_observer.py"
)
OBSERVER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(OBSERVER)

IDS = {
    "listener": "a" * 64,
    "origin": "b" * 64,
    "listener_replacement": "c" * 64,
}


def inspect_rows():
    rows = []
    for index, target in enumerate(OBSERVER.TARGETS):
        rows.append(
            {
                "Id": IDS[target["role"]],
                "Name": f"/{target['name']}",
                "Config": {
                    "Labels": {
                        "com.docker.compose.project": "earlybirds-preview",
                        "com.docker.compose.service": target["service"],
                    }
                },
                "State": {
                    "Status": "running",
                    "StartedAt": f"2026-08-15T10:00:0{index}.000000000Z",
                    "OOMKilled": False,
                },
                "RestartCount": 0,
            }
        )
    return rows


def observations():
    return OBSERVER.parse_docker_inspect(json.dumps(inspect_rows()))


class ListenerContainerObserverTest(unittest.TestCase):
    def test_parses_only_exact_running_compose_targets(self):
        result = observations()
        self.assertEqual(list(result), ["listener", "origin"])
        self.assertEqual(
            result["listener"]["startTimeSeconds"],
            datetime.fromisoformat("2026-08-15T10:00:00+00:00").timestamp(),
        )
        self.assertEqual(
            result["origin"]["startTimeSeconds"],
            datetime.fromisoformat("2026-08-15T10:00:01+00:00").timestamp(),
        )
        self.assertRegex(result["listener"]["identity"], r"^[a-f0-9]{64}$")
        self.assertNotEqual(result["listener"]["identity"], IDS["listener"])

    def test_rejects_missing_duplicate_wrong_boundary_and_stopped_targets(self):
        with self.assertRaisesRegex(ValueError, "incomplete or ambiguous"):
            OBSERVER.parse_docker_inspect("[]")

        duplicate = inspect_rows()
        duplicate[1]["Name"] = duplicate[0]["Name"]
        with self.assertRaisesRegex(ValueError, "duplicated"):
            OBSERVER.parse_docker_inspect(json.dumps(duplicate))

        wrong_project = inspect_rows()
        wrong_project[0]["Config"]["Labels"]["com.docker.compose.project"] = "pmp-myth"
        with self.assertRaisesRegex(ValueError, "fixed boundary"):
            OBSERVER.parse_docker_inspect(json.dumps(wrong_project))

        wrong_service = inspect_rows()
        wrong_service[1]["Config"]["Labels"]["com.docker.compose.service"] = "listener"
        with self.assertRaisesRegex(ValueError, "fixed boundary"):
            OBSERVER.parse_docker_inspect(json.dumps(wrong_service))

        stopped = inspect_rows()
        stopped[0]["State"]["Status"] = "exited"
        with self.assertRaisesRegex(ValueError, "not running"):
            OBSERVER.parse_docker_inspect(json.dumps(stopped))

    def test_durable_epoch_and_monotonic_restart_oom_totals(self):
        first = OBSERVER.advance_observer_state(None, observations(), 1_700_000_000)
        self.assertEqual(first["schemaVersion"], OBSERVER.OBSERVER_SCHEMA_VERSION)
        self.assertEqual(first["targets"]["listener"]["restartEventsTotal"], 0)

        changed = observations()
        changed["listener"].update(
            {
                "startTimeSeconds": changed["listener"]["startTimeSeconds"] + 20,
                "dockerRestartCount": 1,
                "oomKilled": True,
            }
        )
        second = OBSERVER.advance_observer_state(first, changed, 1_700_000_005)
        self.assertEqual(second["epochStartedAtSeconds"], first["epochStartedAtSeconds"])
        self.assertEqual(second["targets"]["listener"]["restartEventsTotal"], 1)
        self.assertEqual(second["targets"]["listener"]["oomEventsTotal"], 1)

        still_oomed = OBSERVER.advance_observer_state(second, changed, 1_700_000_010)
        self.assertEqual(still_oomed["targets"]["listener"]["oomEventsTotal"], 1)
        recovered_observation = copy.deepcopy(changed)
        recovered_observation["listener"]["oomKilled"] = False
        recovered = OBSERVER.advance_observer_state(still_oomed, recovered_observation, 1_700_000_015)
        oomed_again = OBSERVER.advance_observer_state(recovered, changed, 1_700_000_020)
        self.assertEqual(oomed_again["targets"]["listener"]["oomEventsTotal"], 2)

    def test_replacement_preserves_cumulative_totals(self):
        initial = observations()
        initial["listener"]["dockerRestartCount"] = 2
        first = OBSERVER.advance_observer_state(None, initial, 1_700_000_000)
        replacement = observations()
        replacement["listener"].update(
            {
                "identity": IDS["listener_replacement"],
                "startTimeSeconds": replacement["listener"]["startTimeSeconds"] + 60,
                "dockerRestartCount": 1,
            }
        )
        next_state = OBSERVER.advance_observer_state(first, replacement, 1_700_000_005)
        self.assertEqual(next_state["targets"]["listener"]["restartEventsTotal"], 4)

    def test_refuses_corrupt_state_and_backwards_docker_counter(self):
        initial = observations()
        initial["listener"]["dockerRestartCount"] = 2
        first = OBSERVER.advance_observer_state(None, initial, 1_700_000_000)
        corrupt = {**first, "schemaVersion": 99}
        with self.assertRaisesRegex(ValueError, "state is invalid"):
            OBSERVER.advance_observer_state(corrupt, observations(), 1_700_000_005)
        with self.assertRaisesRegex(ValueError, "moved backwards"):
            OBSERVER.advance_observer_state(first, observations(), 1_700_000_005)

    def test_metrics_use_fixed_roles_without_identity_or_container_name(self):
        state = OBSERVER.advance_observer_state(None, observations(), 1_700_000_000)
        metrics = OBSERVER.render_observer_metrics(state)
        self.assertIn("beacon_listener_container_observer_up 1", metrics)
        self.assertEqual(metrics.count('beacon_listener_container_start_time_seconds{role='), 2)
        self.assertEqual(metrics.count('beacon_listener_container_restart_events_total{role='), 2)
        self.assertEqual(metrics.count('beacon_listener_container_oom_events_total{role='), 2)
        self.assertNotIn("earlybirds-preview", metrics)
        self.assertNotIn("beacon-stream", metrics)
        self.assertNotRegex(metrics, r"[a-f0-9]{64}")

        failure = OBSERVER.render_observer_failure_metrics(1_700_000_005)
        self.assertIn("beacon_listener_container_observer_up 0", failure)
        self.assertNotIn("role=", failure)


if __name__ == "__main__":
    unittest.main()
