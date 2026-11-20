#!/usr/bin/env bash
# Runs the shell snippets that the codereview skills tag with
# `<!-- snippet-test: <name> -->` against recorded gh, glab and git output,
# offline. Every tagged snippet needs at least one case.
#
# A case is a directory under tests/fixtures/ holding:
#   snippet   the tag to run
#   vars      placeholder values, one `name=value` per line; `<name>` in the
#             snippet becomes `value`; `name=<name>` keeps text that only
#             looks like a placeholder
#   routes    `<ERE><TAB><response file>[<TAB><exit status>]` per line; the
#             first ERE matching the stubbed command line (`glab api …`)
#             answers it. With a non-zero status a `.json` file goes to
#             stdout, as an API error body does, and any other to stderr.
#             A file holding several JSON documents is one page each:
#             without `--paginate` only the first page is returned.
#   expected  the snippet's stdout. JSON is compared after normalising each
#             document; anything else byte for byte.
#   rc        optional expected exit status (default 0)
#
# Needs bash, awk and jq. Snippets run in plain `bash -c`: the `set -o
# pipefail` they need is their own. Run it from anywhere:
#   plugins/codereview/tests/snippets.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
cases_dir="$root/tests/fixtures"
docs=("$root/skills/loop/SKILL.md" "$root/skills/loop/reference/gitlab-bots.md" "$root/skills/fix/SKILL.md")

command -v jq >/dev/null || { echo "snippets: jq is required" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

# The stub stands in for gh, glab and git. gh applies --jq itself, so the
# stub does the same.
mkdir -p "$work/bin"
cat > "$work/bin/stub" <<'STUB'
#!/usr/bin/env bash
name=$(basename "$0")
line="$name $*"
jqexpr=
if [ "$name" = gh ]; then
  args=("$@")
  for ((i = 0; i < ${#args[@]}; i++)); do
    case ${args[i]} in --jq|-q) jqexpr=${args[i+1]} ;; esac
  done
fi
paginate=no
case " $* " in *" --paginate "*) paginate=yes ;; esac
while IFS=$'\t' read -r re file code || [ -n "$re" ]; do
  case $re in ''|'#'*) continue ;; esac
  if [[ $line =~ $re ]]; then
    f="$SCM_CASE/$file"
    if [ "${code:-0}" != 0 ]; then
      case $file in *.json) cat "$f" ;; *) cat "$f" >&2 ;; esac
      exit "$code"
    fi
    if [ "$paginate" = no ] && [ "$(jq -s length "$f" 2>/dev/null || echo 1)" -gt 1 ]; then
      p=$(mktemp "$SCM_TMP/page.XXXXXX"); jq -c . "$f" | head -n 1 > "$p"; f=$p
    fi
    if [ -n "$jqexpr" ]; then exec jq -r "$jqexpr" "$f"; fi
    exec cat "$f"
  fi
done < "$SCM_CASE/routes"
echo "stub: no route for: $line" >&2
exit 97
STUB
chmod +x "$work/bin/stub"
for t in gh glab git; do ln -s stub "$work/bin/$t"; done

tags() { grep -ho '<!-- snippet-test: [a-z0-9-]* -->' "${docs[@]}" | sed -E 's/<!-- snippet-test: (.*) -->/\1/'; }

extract() {  # the bash block after <!-- snippet-test: $1 -->, without its indent
  awk -v tag="<!-- snippet-test: $1 -->" '
    index($0, tag) { want = 1; next }
    want && /^[[:space:]]*```bash[[:space:]]*$/ { match($0, /^[[:space:]]*/); indent = RLENGTH; inblock = 1; want = 0; next }
    inblock && /^[[:space:]]*```[[:space:]]*$/ { exit }
    inblock { print substr($0, indent + 1) }
  ' "${docs[@]}"
}

normalise() {  # one compact, key-sorted line per JSON document, else the text
  if jq -e . "$1" >/dev/null 2>&1; then jq -cS . "$1"; else cat "$1"; fi
}

fail=0 pass=0
dupes=$(tags | sort | uniq -d)
[ -z "$dupes" ] || { echo "FAIL: tags used twice: $dupes"; fail=$((fail + 1)); }

for tag in $(tags | sort -u); do
  grep -qx "$tag" "$cases_dir"/*/snippet 2>/dev/null \
    || { echo "FAIL: no case runs the '$tag' snippet"; fail=$((fail + 1)); }
done

for case in "$cases_dir"/*/; do
  case=${case%/}
  id=$(basename "$case")
  tag=$(cat "$case/snippet")
  code=$(extract "$tag")
  [ -n "$code" ] || { echo "FAIL $id: no snippet tagged '$tag'"; fail=$((fail + 1)); continue; }
  keep=
  if [ -f "$case/vars" ]; then
    while IFS='=' read -r k v || [ -n "$k" ]; do
      [ -n "$k" ] || continue
      # `name=<name>` marks text in the snippet that only looks like a placeholder
      if [ "$v" = "<$k>" ]; then keep="$keep <$k>"; continue; fi
      code=${code//"<$k>"/"$v"}
    done < "$case/vars"
  fi
  left=$(printf '%s\n' "$code" | grep -oE '<[a-z][a-z_-]*>' | sort -u | grep -vxF -e '<-none->' ${keep:+$(printf -- ' -e %s' $keep)} | tr '\n' ' ' || true)
  [ -z "$left" ] || { echo "FAIL $id: placeholders without a value: $left"; fail=$((fail + 1)); continue; }

  set +e
  (cd "$work" && PATH="$work/bin:$PATH" SCM_CASE="$case" SCM_TMP="$work" bash -c "$code") \
    > "$work/out" 2> "$work/err"
  rc=$?
  set -e
  want_rc=$(cat "$case/rc" 2>/dev/null || echo 0)
  if [ "$rc" != "$want_rc" ]; then
    echo "FAIL $id: exit $rc, expected $want_rc"; sed 's/^/  stderr: /' "$work/err"
    fail=$((fail + 1)); continue
  fi
  if ! diff <(normalise "$case/expected") <(normalise "$work/out") > "$work/diff"; then
    echo "FAIL $id: output differs (< expected, > actual)"; sed 's/^/  /' "$work/diff"
    fail=$((fail + 1)); continue
  fi
  pass=$((pass + 1))
done

echo "snippets: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
