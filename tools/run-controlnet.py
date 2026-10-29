"""Run the exported controls through a pinned, local Diffusers ControlNet pipeline.

Example: python tools/run-controlnet.py pose.zip --view front --out artifacts/ai-run
Use --ablation to compare pose, pose+depth, and pose+depth+normal with one seed.
Only safetensors and the four public model revisions shipped in the recipe are used.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import time
import zipfile

os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
os.environ.setdefault('HF_HUB_DISABLE_PROGRESS_BARS', '1')

MODEL_MANIFEST = json.loads((Path(__file__).resolve().parents[1] / 'workflows/controlnet-models.json').read_text(encoding='utf8'))
MODELS = {kind: (item['repo'], item['revision']) for kind, item in MODEL_MANIFEST.items()}
FILES = {'pose': 'openpose-body-hands.png', 'depth': 'depth.png', 'normal': 'normal.png'}
MAX_PNG_BYTES = 32_000_000


def generation_size(width: int, height: int):
    scale = 512 / max(width, height)
    return tuple(max(64, math.floor(value * scale / 8 + .5) * 8) for value in (width, height))


def prepare_control(image, size):
    from PIL import Image, ImageOps
    return ImageOps.pad(image, size, method=Image.Resampling.LANCZOS, color=(0, 0, 0))


def read_export(filename: Path, view: str | None):
    from PIL import Image
    with zipfile.ZipFile(filename) as archive:
        def read(name: str, limit=2_000_000):
            entry = archive.getinfo(name)
            if entry.file_size > limit:
                raise ValueError(f'Export member too large: {name}')
            return archive.read(entry)

        recipe = json.loads(read('workflow-controlnet.json'))
        manifest = json.loads(read('manifest.json'))
        if recipe.get('format') != 'momo-pose-forge-controlnet' or recipe.get('version') != 1:
            raise ValueError('Unsupported workflow recipe')
        for kind, (repo, revision) in MODELS.items():
            if recipe.get('models', {}).get(kind) != {'repo': repo, 'revision': revision}:
                raise ValueError(f'Unexpected model or revision: {kind}')
        views = [item['id'] for item in manifest['views']]
        if any(type(manifest.get(key)) is not int or not 0 < manifest[key] <= 2048 for key in ('width', 'height')):
            raise ValueError('Invalid control image dimensions')
        selected = view or views[0]
        if selected not in views or selected not in ['front', 'oblique', 'side', 'high', 'low', 'current']:
            raise ValueError('Choose a view contained in this export')
        controls, hashes = {}, {}
        for item in recipe['controls']:
            kind = item['kind']
            if kind not in FILES or item['file'] != FILES[kind]:
                raise ValueError('Unknown control image')
            scale = item.get('scale')
            if kind in controls or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 0 <= scale <= 2:
                raise ValueError('Invalid or duplicate control scale')
            data = read(f'{selected}/{FILES[kind]}', MAX_PNG_BYTES)
            image = Image.open(io.BytesIO(data))
            if image.size != (manifest['width'], manifest['height']) or max(image.size) > 2048:
                raise ValueError('Control image dimensions do not match the manifest')
            controls[kind] = image.convert('RGB')
            hashes[kind] = hashlib.sha256(data).hexdigest()
        if not controls:
            raise ValueError('No control images in this export')
        return recipe, manifest, selected, controls, hashes


def run(args):
    from PIL import Image, ImageDraw
    import torch
    import diffusers
    import transformers
    from diffusers import ControlNetModel, StableDiffusionControlNetPipeline, UniPCMultistepScheduler
    from huggingface_hub import snapshot_download

    recipe, manifest, view, images, hashes = read_export(args.zip, args.view)
    if not torch.cuda.is_available():
        raise RuntimeError('This reference workflow requires CUDA PyTorch; no generation was run.')
    args.out.mkdir(parents=True, exist_ok=True)
    generation = recipe['generation']
    width, height = generation['width'], generation['height']
    seed = args.seed if args.seed is not None else generation['seed']
    steps = args.steps if args.steps is not None else generation['steps']
    if not 1 <= steps <= 100 or not 0 <= seed <= 2**32 - 1 or (width, height) != generation_size(manifest['width'], manifest['height']):
        raise ValueError('Invalid seed, step count, or generation dimensions')
    prompt = args.prompt or generation['prompt']
    groups = [list(images)]
    if args.ablation:
        if not all(kind in images for kind in FILES):
            raise ValueError('--ablation requires pose, depth and normal in the ZIP')
        groups = [['pose'], ['pose', 'depth'], ['pose', 'depth', 'normal']]
    loaded, resolved = {}, {}
    for kind in ['base', *images]:
        repo, revision = MODELS[kind]
        patterns = ['model_index.json', '*/config.json', 'scheduler/*.json', 'tokenizer/*', 'feature_extractor/*.json', '*/*.fp16.safetensors', 'LICENSE*'] if kind == 'base' else ['config.json', 'diffusion_pytorch_model.fp16.safetensors', 'LICENSE*']
        print(f'Preparing {kind}: {repo}@{revision}', flush=True)
        resolved[kind] = snapshot_download(repo, revision=revision, cache_dir=str(args.model_cache), allow_patterns=patterns, token=False, local_files_only=args.offline)
        if kind != 'base':
            loaded[kind] = ControlNetModel.from_pretrained(resolved[kind], torch_dtype=torch.float16, variant='fp16', use_safetensors=True, local_files_only=True)
    torch.set_num_threads(4)
    results, pipeline = [], None
    for kinds in groups:
        label = '-'.join(kinds)
        if pipeline is not None:
            pipeline.remove_all_hooks()
            del pipeline
            torch.cuda.empty_cache()
        pipeline = StableDiffusionControlNetPipeline.from_pretrained(resolved['base'], controlnet=[loaded[kind] for kind in kinds], torch_dtype=torch.float16, variant='fp16', use_safetensors=True, local_files_only=True)
        pipeline.scheduler = UniPCMultistepScheduler.from_config(pipeline.scheduler.config)
        pipeline.enable_model_cpu_offload()
        pipeline.enable_vae_slicing()
        pipeline.enable_attention_slicing('auto')
        controls = [prepare_control(images[kind], (width, height)) for kind in kinds]
        scales = [next(item['scale'] for item in recipe['controls'] if item['kind'] == kind) for kind in kinds]
        if any(not isinstance(scale, (int, float)) or not 0 <= scale <= 2 for scale in scales):
            raise ValueError('Control scale outside supported range')
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        output = pipeline(prompt=prompt, negative_prompt=generation['negativePrompt'], image=controls, width=width, height=height, num_inference_steps=steps, guidance_scale=float(generation['guidanceScale']), controlnet_conditioning_scale=scales, generator=torch.Generator(device='cpu').manual_seed(seed))
        image = output.images[0]
        output_path = args.out / f'{view}-{label}.png'
        image.save(output_path)
        record = {'controls': kinds, 'scales': scales, 'output': output_path.name, 'seconds': time.perf_counter()-started, 'peakCudaAllocatedMiB': torch.cuda.max_memory_allocated()/1024**2, 'nsfwContentDetected': output.nsfw_content_detected}
        results.append(record)
        print(json.dumps(record), flush=True)
    assert pipeline is not None
    pipeline.remove_all_hooks()
    report = {'inputZip': args.zip.name, 'inputSha256': hashlib.sha256(args.zip.read_bytes()).hexdigest(), 'view': view, 'inputImageSha256': hashes, 'sourceResolution': [manifest['width'], manifest['height']], 'generationResolution': [width, height], 'seed': seed, 'steps': steps, 'prompt': prompt, 'negativePrompt': generation['negativePrompt'], 'scheduler': 'UniPCMultistepScheduler', 'models': recipe['models'], 'runtime': {'torch': torch.__version__, 'diffusers': diffusers.__version__, 'transformers': transformers.__version__, 'gpu': torch.cuda.get_device_name()}, 'results': results, 'scope': 'Generation and input compatibility; does not certify exact finger anatomy or multi-view identity consistency.'}
    (args.out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    sources = list(images.items())
    sheet = Image.new('RGB', ((len(sources)+len(results))*width, height+36), '#202121')
    draw = ImageDraw.Draw(sheet)
    for i, (label, image) in enumerate(sources):
        sheet.paste(prepare_control(image, (width, height)), (i*width, 36));draw.text((i*width+8, 10), label, fill='white')
    for i, result in enumerate(results, start=len(sources)):
        sheet.paste(Image.open(args.out/result['output']).convert('RGB'), (i*width, 36));draw.text((i*width+8, 10), '+'.join(result['controls']), fill='white')
    sheet.save(args.out / 'comparison.png')
    print(f'Completed. Evidence: {args.out / "report.json"}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip', type=Path)
    parser.add_argument('--view')
    parser.add_argument('--out', type=Path, default=Path('artifacts/controlnet-run'))
    parser.add_argument('--model-cache', type=Path, default=Path('artifacts/ai-validation/models'))
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--ablation', action='store_true')
    parser.add_argument('--seed', type=int)
    parser.add_argument('--steps', type=int)
    parser.add_argument('--prompt')
    run(parser.parse_args())
