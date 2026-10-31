import unittest
import json
import tempfile
import os
from unittest.mock import patch
from langflow.tests import test_sqlite_migration  # Installs minimal Langflow UI stubs only.
from needs_gap_calculator import assess_shelter, calculate, NeedsGapCalculator, extract_json
from sigap_contracts import save_snapshot


class SpherePlanningTests(unittest.TestCase):
    def record(self, **changes):
        return {"shelter_name": "A", "total_people": 100, "infants_toddlers": 10,
                "children": 20, "elderly": 5, "pregnant": 3, "breastfeeding": 4, **changes}

    def test_population_reference_and_disjoint_age_allocations_reconcile(self):
        result = assess_shelter(self.record())
        p = result["planning"]
        self.assertTrue(p["complete_age_counts"])
        rows = {r["key"]: r for r in p["age_groups"]}
        self.assertEqual(rows["adults"]["people"], 65)
        self.assertEqual(rows["children"]["water_l"], 300)
        self.assertEqual(rows["elderly"]["energy_kcal"], 10500)
        self.assertEqual(sum(r["people"] for r in rows.values()), 100)
        self.assertEqual(sum(r["water_l"] for r in rows.values()), result["needs"]["air_liter_per_hari"]["value"])
        self.assertEqual(sum(r["energy_kcal"] for r in rows.values()), result["needs"]["kkal_per_hari"]["value"])
        self.assertEqual(p["nutrition"], {"energy_kcal": 210000, "protein_g": 5300, "fat_g": 4000,
                                           "carbohydrate_equivalent_g": 38200})

    def test_overlap_groups_never_inflate_the_population(self):
        a = assess_shelter(self.record())["planning"]
        b = assess_shelter(self.record(pregnant=20, breastfeeding=30, disability=15))["planning"]
        self.assertEqual(a, b)

    def test_missing_is_not_zero_and_adults_are_not_guessed(self):
        p = assess_shelter(self.record(children=None))["planning"]
        self.assertFalse(p["complete_age_counts"])
        self.assertIsNone(p["age_groups"][1]["energy_kcal"])
        self.assertIsNone(p["age_groups"][2]["people"])
        self.assertEqual(p["nutrition"]["protein_g"], 5300)
        self.assertTrue(p["issues"])

    def test_inconsistent_age_counts_block_allocations_instead_of_clamping_adults(self):
        p = assess_shelter(self.record(children=90))["planning"]
        self.assertFalse(p["complete_age_counts"])
        self.assertTrue(all(row["energy_kcal"] is None for row in p["age_groups"]))
        self.assertIsNone(p["age_groups"][2]["people"])

    def test_invalid_and_unknown_counts_never_produce_invented_values(self):
        for value in [-1, 1.5, True, None]:
            with self.subTest(value=value):
                p = assess_shelter(self.record(children=value))["planning"]
                self.assertIsNone(p["age_groups"][1]["people"])
                self.assertIsNone(p["age_groups"][2]["people"])
        for value in [None, -1, True]:
            p = assess_shelter(self.record(total_people=value))["planning"]
            self.assertTrue(all(v is None for v in p["nutrition"].values()))

    def test_explicit_zero_remains_zero_and_totals_do_not_change(self):
        p = assess_shelter(self.record(total_people=0, infants_toddlers=0, children=0, elderly=0))["planning"]
        self.assertTrue(p["complete_age_counts"])
        self.assertTrue(all(row["water_l"] == 0 for row in p["age_groups"]))
        self.assertEqual(p["nutrition"]["carbohydrate_equivalent_g"], 0)
        result = calculate([self.record()])
        self.assertEqual(result["totals"]["kkal_per_hari"], 210000)

    def test_workflow_reads_the_exact_snapshot_and_returns_detail_without_storage_write(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"SIGAP_SNAPSHOT_DIR": folder}):
            reference = save_snapshot({"records": [self.record()], "snapshot_kind": "storage_readback"})
            output = NeedsGapCalculator(records_json=json.dumps(reference)).build_needs_gap().text
            result = extract_json(output)
            self.assertEqual(result["snapshot_id"], reference["snapshot_id"])
            self.assertEqual(result["snapshot_sha256"], reference["snapshot_sha256"])
            self.assertEqual(result["shelters"][0]["planning"]["nutrition"]["protein_g"], 5300)


if __name__ == "__main__":
    unittest.main()
