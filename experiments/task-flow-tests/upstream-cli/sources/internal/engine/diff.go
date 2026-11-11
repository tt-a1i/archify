package engine

import (
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/gtindo/task-view/internal/review"
)

// File diff statuses.
const (
	DiffAdded    = "added"
	DiffModified = "modified"
	DiffDeleted  = "deleted"
	DiffRenamed  = "renamed"
)

// binarySniffBytes is how far Git looks for a NUL byte to call a file binary.
const binarySniffBytes = 8000

// gitHeaderOverhead is the length of "a/ b/" in an unquoted `diff --git a/x b/x`
// header, around the two paths.
const gitHeaderOverhead = len("a/ b/")

// Hunk is one zero-context hunk. Old lines use initial-state numbers, new
// lines final-state numbers.
type Hunk struct {
	OldStart, OldCount int
	NewStart, NewCount int
	Old, New           []string
}

// NewEnd is the last final-state line the hunk adds, or NewStart-1.
func (h *Hunk) NewEnd() int { return h.NewStart + h.NewCount - 1 }

// OldEnd is the last initial-state line the hunk removes, or OldStart-1.
func (h *Hunk) OldEnd() int { return h.OldStart + h.OldCount - 1 }

// PureDeletion reports whether the hunk only removes lines.
func (h *Hunk) PureDeletion() bool { return h.NewCount == 0 }

// FileDiff is the diff of one file between the initial and final states.
type FileDiff struct {
	Path      string // final path; empty for a deleted file
	OldPath   string // initial path; empty for an added file
	Status    string // one of the Diff* statuses
	Binary    bool
	Untracked bool // an untracked WORKTREE file, which `git diff` leaves out
	Hunks     []*Hunk
}

// Key is the path the file is referenced by: final path, or initial path
// for a deleted file.
func (f *FileDiff) Key() string {
	if f.Path != "" {
		return f.Path
	}

	return f.OldPath
}

// Added counts the final-state lines the file diff adds.
func (f *FileDiff) Added() int {
	added := 0
	for _, hunk := range f.Hunks {
		added += hunk.NewCount
	}

	return added
}

// Removed counts the initial-state lines the file diff removes.
func (f *FileDiff) Removed() int {
	removed := 0
	for _, hunk := range f.Hunks {
		removed += hunk.OldCount
	}

	return removed
}

// ChangeState is the node change state matching this file diff.
func (f *FileDiff) ChangeState() string {
	switch f.Status {
	case DiffAdded:
		return review.ChangeAdded
	case DiffDeleted:
		return review.ChangeDeleted
	}

	return review.ChangeModified
}

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

// ParseDiff parses `git diff --unified=0 -M` output.
func ParseDiff(out string) []*FileDiff {
	var files []*FileDiff
	var file *FileDiff
	var hunk *Hunk
	inHeader := false

	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			oldPath, newPath := splitGitHeader(strings.TrimPrefix(line, "diff --git "))
			file = &FileDiff{Path: newPath, OldPath: oldPath, Status: DiffModified}
			files = append(files, file)
			hunk = nil
			inHeader = true
		case file == nil:
			continue
		case inHeader && strings.HasPrefix(line, "new file mode"):
			file.Status = DiffAdded
			file.OldPath = ""
		case inHeader && strings.HasPrefix(line, "deleted file mode"):
			file.Status = DiffDeleted
			file.Path = ""
		case inHeader && strings.HasPrefix(line, "rename from "):
			file.OldPath = unquote(strings.TrimPrefix(line, "rename from "))
			file.Status = DiffRenamed
		case inHeader && strings.HasPrefix(line, "rename to "):
			file.Path = unquote(strings.TrimPrefix(line, "rename to "))
			file.Status = DiffRenamed
		case inHeader && strings.HasPrefix(line, "Binary files "):
			file.Binary = true
		case inHeader && strings.HasPrefix(line, "--- "):
			if oldPath := diffPath(strings.TrimPrefix(line, "--- ")); oldPath != "" {
				file.OldPath = oldPath
			}
		case inHeader && strings.HasPrefix(line, "+++ "):
			if newPath := diffPath(strings.TrimPrefix(line, "+++ ")); newPath != "" {
				file.Path = newPath
			}
		case strings.HasPrefix(line, "@@ "):
			inHeader = false
			if parsed := parseHunkHeader(line); parsed != nil {
				hunk = parsed
				file.Hunks = append(file.Hunks, hunk)
			}
		case hunk != nil && strings.HasPrefix(line, "-"):
			hunk.Old = append(hunk.Old, trimCR(line[1:]))
		case hunk != nil && strings.HasPrefix(line, "+"):
			hunk.New = append(hunk.New, trimCR(line[1:]))
		}
	}

	// A pure mode change has no hunks and is not part of the change.
	return slices.DeleteFunc(files, func(file *FileDiff) bool {
		metadataOnly := len(file.Hunks) == 0 && !file.Binary
		modeChange := file.Status == DiffModified
		samePathRename := file.Status == DiffRenamed && file.Path == file.OldPath

		return metadataOnly && (modeChange || samePathRename)
	})
}

// parseHunkHeader reads an `@@ -a,b +c,d @@` line; nil when it does not
// match. A missing count means one line.
func parseHunkHeader(line string) *Hunk {
	match := hunkHeader.FindStringSubmatch(line)
	if match == nil {
		return nil
	}

	return &Hunk{
		OldStart: atoi(match[1]),
		OldCount: atoiDefault(match[2], 1),
		NewStart: atoi(match[3]),
		NewCount: atoiDefault(match[4], 1),
	}
}

// diffPath reads the path of a `---` or `+++` line; empty for /dev/null.
func diffPath(field string) string {
	field = strings.TrimRight(field, "\t")
	if field == "/dev/null" {
		return ""
	}

	field = unquote(field)
	if strings.HasPrefix(field, "a/") || strings.HasPrefix(field, "b/") {
		return field[2:]
	}

	return field
}

// splitGitHeader splits the "a/x b/y" part of a `diff --git` line.
func splitGitHeader(rest string) (string, string) {
	if strings.HasPrefix(rest, `"`) {
		oldPath, tail := readQuoted(rest)
		newPath := strings.TrimSpace(tail)

		return strings.TrimPrefix(unquote(oldPath), "a/"), strings.TrimPrefix(unquote(newPath), "b/")
	}

	// Paths may contain " b/", so first try the split where both halves are
	// the same path, which holds for everything but renames.
	pathsLen := len(rest) - gitHeaderOverhead
	if pathsLen > 0 && pathsLen%2 == 0 {
		pathLen := pathsLen / 2
		oldPath, newPath := rest[2:2+pathLen], rest[2+pathLen+3:]
		if oldPath == newPath {
			return oldPath, newPath
		}
	}

	if sep := strings.Index(rest, " b/"); sep >= 0 {
		return strings.TrimPrefix(rest[:sep], "a/"), unquote(rest[sep+3:])
	}

	return rest, rest
}

// readQuoted splits a leading C-quoted string off text, honouring escapes.
func readQuoted(text string) (string, string) {
	for i := 1; i < len(text); i++ {
		if text[i] == '\\' {
			i++

			continue
		}

		if text[i] == '"' {
			return text[:i+1], text[i+1:]
		}
	}

	return text, ""
}

// unquote decodes a path Git C-quoted because of special characters.
func unquote(text string) string {
	isQuoted := len(text) >= 2 && text[0] == '"' && text[len(text)-1] == '"'
	if !isQuoted {
		return text
	}

	if unquoted, err := strconv.Unquote(text); err == nil {
		return unquoted
	}

	return text
}

func trimCR(line string) string { return strings.TrimSuffix(line, "\r") }

func atoi(digits string) int {
	value, _ := strconv.Atoi(digits)

	return value
}

func atoiDefault(digits string, fallback int) int {
	if digits == "" {
		return fallback
	}

	return atoi(digits)
}

// SplitLines splits file content into lines; CRLF and LF both end a line,
// and a final line break does not start a new line.
func SplitLines(data []byte) []string {
	if len(data) == 0 {
		return nil
	}

	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	for i, line := range lines {
		lines[i] = trimCR(line)
	}

	return lines
}

// IsBinary applies Git's heuristic: a NUL byte in the first 8000 bytes.
func IsBinary(data []byte) bool {
	return slices.Contains(data[:min(len(data), binarySniffBytes)], 0)
}
