"""Inventory local image filesystems without executing image code."""
import json
import subprocess
import tarfile


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def fields(data, separator):
    for block in data.split("\n\n"):
        yield dict(
            line.split(separator, 1)
            for line in block.splitlines()
            if separator in line and not line.startswith(" ")
        )


def inspect_image(image):
    metadata = json.loads(docker("image", "inspect", image))[0]
    digests = metadata.get("RepoDigests") or []
    if not digests:
        raise RuntimeError(f"No registry digest for {image}")
    print(f"IMAGE {image} {metadata['Os']}/{metadata['Architecture']}", flush=True)
    for digest in sorted(digests):
        print(f"DIGEST {digest}")
    print(f"IMAGE_ID {metadata['Id']}")
    container = docker("create", image)
    packages = []
    notices = []
    try:
        with subprocess.Popen(
            ["docker", "export", container], stdout=subprocess.PIPE
        ) as process:
            with tarfile.open(fileobj=process.stdout, mode="r|*") as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    name = member.name.removeprefix("./").lstrip("/")
                    basename = name.rsplit("/", 1)[-1].lower()
                    if basename.startswith(("license", "licence", "notice", "copyright")):
                        notices.append(name)
                    if name not in ("var/lib/dpkg/status", "lib/apk/db/installed"):
                        continue
                    entry = archive.extractfile(member)
                    if entry is None:
                        raise RuntimeError(f"Unable to read {name}")
                    data = entry.read().decode("utf-8", errors="replace")
                    if name == "var/lib/dpkg/status":
                        packages.extend(
                            (p["Package"], p.get("Version", "?"), "SEE COPYRIGHT")
                            for p in fields(data, ": ")
                            if "Package" in p
                            and p.get("Status") == "install ok installed"
                        )
                    else:
                        packages.extend(
                            (p["P"], p.get("V", "?"), p.get("L", "UNKNOWN"))
                            for p in fields(data, ":")
                            if "P" in p
                        )
            if process.wait() != 0:
                raise RuntimeError(f"docker export failed for {image}")
    finally:
        docker("rm", "-v", container)
    print(f"OS_PACKAGES {len(packages)}")
    for package in sorted(packages):
        print("OS_PACKAGE", *package, sep=" | ")
    print(f"NOTICE_FILES {len(notices)}")
    for notice in sorted(notices):
        print(f"NOTICE_FILE {notice}")
    if not packages:
        print("REVIEW no recognized OS package database; inspect binary dependencies")
    print("REVIEW embedded application dependencies and distribution obligations")


for image in ("postgres:17", "chrislusf/seaweedfs:4.51"):
    inspect_image(image)
