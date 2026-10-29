"""Small contract tests; no model download or GPU execution."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from PIL import Image

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run-controlnet.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ExportContract(unittest.TestCase):
    def export(self, mutate=None, image_size=(6, 8), omit=None):
        recipe = {'format': 'momo-pose-forge-controlnet', 'version': 1, 'models': runner.MODEL_MANIFEST,
                  'controls': [{'kind': key, 'file': name, 'scale': .5} for key, name in runner.FILES.items()]}
        if mutate:
            mutate(recipe)
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        target = Path(folder.name) / 'export.zip'
        image = io.BytesIO()
        Image.new('RGB', image_size, '#8080ff').save(image, 'PNG')
        with zipfile.ZipFile(target, 'w') as archive:
            archive.writestr('workflow-controlnet.json', json.dumps(recipe))
            archive.writestr('manifest.json', json.dumps({'views': [{'id': 'front'}], 'width': 6, 'height': 8}))
            for name in runner.FILES.values():
                if name != omit:
                    archive.writestr('front/' + name, image.getvalue())
        return target

    def test_reads_export_without_extracting_files(self):
        recipe, manifest, view, controls, hashes = runner.read_export(self.export(), None)
        self.assertEqual(view, 'front')
        self.assertEqual(list(controls), ['pose', 'depth', 'normal'])
        self.assertTrue(all(len(value) == 64 for value in hashes.values()))

    def test_rejects_unexpected_model_revision(self):
        def alter(r):
            r['models'] = {**runner.MODEL_MANIFEST, 'pose': {'repo': 'other/repo', 'revision': 'unknown'}}
        with self.assertRaisesRegex(ValueError, 'Unexpected model'):
            runner.read_export(self.export(alter), None)

    def test_rejects_view_not_in_export(self):
        with self.assertRaisesRegex(ValueError, 'Choose a view'):
            runner.read_export(self.export(), '../outside')

    def test_rejects_wrong_image_size(self):
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            runner.read_export(self.export(image_size=(12, 16)), None)

    def test_rejects_missing_control(self):
        with self.assertRaises(KeyError):
            runner.read_export(self.export(omit='normal.png'), None)

    def test_rejects_path_in_control_filename(self):
        with self.assertRaisesRegex(ValueError, 'Unknown control'):
            runner.read_export(self.export(lambda r: r['controls'][0].update(file='../other.png')), None)

    def test_rejects_nan_scale(self):
        with self.assertRaisesRegex(ValueError, 'control scale'):
            runner.read_export(self.export(lambda r: r['controls'][0].update(scale=float('nan'))), None)

    def test_rejects_duplicate_control(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            runner.read_export(self.export(lambda r: r['controls'].append(r['controls'][0])), None)


if __name__ == '__main__':
    unittest.main()
