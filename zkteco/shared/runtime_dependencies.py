"""Verify that the selected interpreter has the versions declared in requirements.txt."""
from importlib.metadata import PackageNotFoundError, version
import importlib.util
from pathlib import Path
import re
import sys

PACKAGE_MODULES = {"waitress": "waitress", "pyzk": "zk"}
REQUIREMENTS_FILE = Path(__file__).resolve().parents[1] / "requirements.txt"


def check_runtime_dependencies(packages=None):
    if sys.version_info < (3, 11):
        raise RuntimeError("ZKTeco requires Python 3.11 or newer.")
    installed_versions = {}
    for line in REQUIREMENTS_FILE.read_text(encoding="utf-8").splitlines():
        declaration = line.split("#", 1)[0].strip()
        if not declaration:
            continue
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)", declaration)
        if not match:
            raise ValueError(f"Expected a pinned package version in {REQUIREMENTS_FILE.name}.")
        package_name, expected_version = match.groups()
        if packages is not None and package_name not in packages:
            continue
        try:
            installed_version = version(package_name)
        except PackageNotFoundError:
            installed_version = None
        module_name = PACKAGE_MODULES[package_name]
        if installed_version != expected_version or importlib.util.find_spec(module_name) is None:
            raise RuntimeError(
                f"{package_name}=={expected_version} is required in {sys.executable}; "
                "run npm run zkteco:setup with the same ZKTECO_PYTHON setting."
            )
        installed_versions[package_name] = installed_version
    return installed_versions


if __name__ == "__main__":
    try:
        for package_name, installed_version in check_runtime_dependencies().items():
            print(f"{package_name}=={installed_version}: installed and importable")
        print(f"Python: {sys.executable}")
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
