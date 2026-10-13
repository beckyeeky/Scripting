import json
import os
import sys
import urllib.request
import urllib.error

TOKEN = os.environ["GITHUB_TOKEN"]
REPO = "beckyeeky/Scripting"
TAG = "v1.7.13.5-pixivreader"
NAME = "Pix-Scripting 1.7.13.5（feature/pixivreader-port）"
BODY = open(sys.argv[1], encoding="utf-8").read()
ASSETS = [
    (sys.argv[2], "application/octet-stream"),
    (sys.argv[3], "text/plain"),
]


def api(url, method="GET", data=None, content_type="application/json"):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "minis")
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", "ignore")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as err:
        sys.stderr.write("HTTP %s %s\n%s\n" % (err.code, url, err.read().decode("utf-8", "ignore")[:600]))
        sys.exit(1)


# 已存在同名 Release 时复用，避免重复创建
existing = None
for rel in api("https://api.github.com/repos/%s/releases?per_page=50" % REPO):
    if rel.get("tag_name") == TAG:
        existing = rel
        break

if existing:
    rel = api(
        "https://api.github.com/repos/%s/releases/%s" % (REPO, existing["id"]),
        method="PATCH",
        data=json.dumps({"name": NAME, "body": BODY, "prerelease": True, "draft": False}).encode(),
    )
else:
    rel = api(
        "https://api.github.com/repos/%s/releases" % REPO,
        method="POST",
        data=json.dumps({
            "tag_name": TAG,
            "name": NAME,
            "body": BODY,
            "draft": False,
            "prerelease": True,
        }).encode(),
    )

release_id = rel["id"]
upload_url = rel["upload_url"].split("{")[0]
have = {a["name"] for a in api("https://api.github.com/repos/%s/releases/%s/assets" % (REPO, release_id))}

uploaded = []
for path, ctype in ASSETS:
    name = os.path.basename(path)
    if name in have:
        print("已存在，跳过上传：%s" % name)
        uploaded.append(name)
        continue
    with open(path, "rb") as handle:
        payload = handle.read()
    asset = api(
        "%s?name=%s" % (upload_url, urllib.request.quote(name)),
        method="POST",
        data=payload,
        content_type=ctype,
    )
    uploaded.append(asset.get("name"))
    print("已上传：%s (%s bytes)" % (asset.get("name"), asset.get("size")))

print("release_url=%s" % rel.get("html_url"))
print("assets=%s" % ",".join(sorted(uploaded)))
print("prerelease=%s draft=%s" % (rel.get("prerelease"), rel.get("draft")))
