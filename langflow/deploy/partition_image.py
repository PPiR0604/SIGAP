"""Repackage the pinned vendor filesystem into bounded OCI layers for VCR.

Runs only in the Docker build stage. Does not install or remove vendor dependencies.
"""
import os
import shutil
import stat
from pathlib import Path

PARTS = 16
LIMIT = 224 * 1024 * 1024  # Uncompressed bound, below VCR's 500 MB compressed-layer limit.
EXCLUDE = {'dev', 'proc', 'sys', 'run', 'tmp', 'mnt', 'media', 'image-parts', '.dockerenv'}


def partition(source, output, parts=PARTS, limit=LIMIT, excluded=EXCLUDE):
    source, output = Path(source), Path(output)
    if output.exists():
        raise ValueError('Partition output must be new.')
    output.mkdir(parents=True)
    roots = [output / f'part{i:02}' for i in range(parts)]
    for root in roots:
        root.mkdir()
    entries, directories = [], []
    for parent, names, files in os.walk(source, followlinks=False):
        relative = Path(parent).relative_to(source)
        if relative == Path('.'):
            names[:] = [name for name in names if name not in excluded]
            files = [name for name in files if name not in excluded]
        links = [name for name in names if (Path(parent) / name).is_symlink()]
        names[:] = [name for name in names if name not in links]
        directories.append(relative)
        for name in files + links:
            path = Path(parent) / name
            metadata = path.lstat()
            if stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                # Include path/metadata overhead when bounding each layer.
                entries.append((metadata.st_size + 2048, path.relative_to(source)))
    created = [set() for _ in roots]
    def directory(index, relative):
        if relative in created[index]:
            return
        destination = roots[index] / relative
        destination.mkdir(parents=True, exist_ok=True)
        # Keep private directories private and /tmp writable for the service user.
        original = source / relative
        if original.is_dir():
            shutil.copystat(original, destination, follow_symlinks=False)
        created[index].add(relative)
    for relative in directories:
        directory(0, relative)
    sizes = [0] * parts
    for size, relative in sorted(entries, key=lambda item: (-item[0], str(item[1]))):
        index = min(range(parts), key=lambda i: sizes[i])
        if sizes[index] + size > limit:
            raise ValueError('Vendor filesystem exceeds the configured VCR layer bounds.')
        for parent in reversed(relative.parents):
            directory(index, parent)
        shutil.copy2(source / relative, roots[index] / relative, follow_symlinks=False)
        sizes[index] += size
    for name in ('dev', 'proc', 'sys', 'run', 'tmp'):
        path = roots[0] / name
        path.mkdir(exist_ok=True)
        path.chmod(0o1777 if name == 'tmp' else 0o755)
    print('Vendor filesystem partitioned into', parts, 'layers; largest bounded payload:', max(sizes), flush=True)
    return sizes


if __name__ == '__main__':
    partition('/', '/image-parts')
