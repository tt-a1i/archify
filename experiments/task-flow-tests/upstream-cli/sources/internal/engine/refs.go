package engine

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/gtindo/task-view/internal/review"
)

// Ref state kinds: which state a ref was read in.
const (
	stateKindFinal   = "final"
	stateKindInitial = "initial"
	stateKindAt      = "at"
)

// maxSiteSuggestions caps the lines a site_mismatch hint suggests.
const maxSiteSuggestions = 3

// maxListedHunks caps the hunks a hint lists before eliding the rest.
const maxListedHunks = 6

// siteDrift is how far, nearest first, a site's `contains` may sit from its
// `line` and still verify with a site_offset warning.
var siteDrift = []int{1, -1, 2, -2}

// RefResult is the outcome of checking one ref.
type RefResult struct {
	// Status is the ref's verification status.
	Status string `json:"status"`
	// Codes lists every finding code the ref raised.
	Codes []string `json:"codes,omitempty"`
	// Reason and Hint come from the finding that set Status.
	Reason     string `json:"reason,omitempty"`
	Hint       string `json:"hint,omitempty"`
	State      string `json:"state,omitempty"`     // SHA or WORKTREE that was read
	StateKind  string `json:"stateKind,omitempty"` // final, initial or at
	ActualLine int    `json:"actualLine,omitempty"`
	// Language is the ref's file language, empty when none matches.
	Language string `json:"language,omitempty"`
}

// refCheck carries one ref through its checks.
type refCheck struct {
	engine *Engine
	ref    *review.Ref
	path   string
	node   *review.Node // set for node refs only
	result *RefResult
	repo   *RepoState
}

// record adds a finding located at the ref and lists its code on the
// result, without changing the result's status.
func (c *refCheck) record(code, msg, hint string) review.Finding {
	finding := review.NewFinding(code, c.path, msg, hint)
	finding.Repo = c.ref.Repo
	finding.File = c.ref.File
	if c.ref.Start() > 0 {
		finding.Lines = []int{c.ref.Start(), c.ref.End()}
	}

	c.engine.Findings = append(c.engine.Findings, finding)
	c.result.Codes = append(c.result.Codes, code)

	return finding
}

// fail records a finding and makes it the ref's status when it is the
// first failure or escalates contradicted to unresolved.
func (c *refCheck) fail(code, msg, hint string) {
	finding := c.record(code, msg, hint)
	firstFailure := c.result.Status == review.StatusVerified
	escalates := c.result.Status == review.StatusContradicted && finding.Status == review.StatusUnresolved
	if !firstFailure && !escalates {
		return
	}

	c.result.Status = finding.Status
	c.result.Reason = msg
	c.result.Hint = hint
}

// checkRef resolves one ref; node is set for node refs, whose change
// state is checked against the diff.
func (e *Engine) checkRef(ref *review.Ref, path string, node *review.Node) *RefResult {
	result := &RefResult{Status: review.StatusVerified}
	repo := e.repoByID[ref.Repo]
	if repo == nil || !repo.OK {
		result.Status = review.StatusUnresolved
		result.Reason = fmt.Sprintf("repo %q could not be resolved; fix its commits first", ref.Repo)

		return result
	}

	check := &refCheck{
		engine: e,
		ref:    ref,
		path:   path,
		node:   node,
		result: result,
		repo:   repo,
	}
	if ref.File != "" {
		result.Language = repo.Language(ref.File, ref.Language)
	}

	state, ok := check.resolveState()
	if !ok {
		return result
	}

	if ref.Type == review.RefCommit {
		check.checkCommit()

		return result
	}

	content := repo.Read(state, ref.File)
	if !content.Exists {
		check.fail("file_not_found",
			fmt.Sprintf("%s not found in the %s of %s", ref.File, stateDescription(result.StateKind, ref.At), ref.Repo),
			missingFileHint(repo, ref, node))

		return result
	}

	if ref.IsLineBased() && !check.checkLineBounds(content) {
		return result
	}

	check.checkByType(content)

	return result
}

// resolveState picks the state a ref is read in: its `at` commit, the
// initial state for deleted nodes, else the final state. ok is false when
// `at` is not a listed commit.
func (c *refCheck) resolveState() (string, bool) {
	ref, node := c.ref, c.node
	state := StateFinal
	c.result.StateKind = stateKindFinal
	switch {
	case ref.At != "":
		if !slices.Contains(c.repo.Commits, ref.At) {
			c.fail("bad_at", fmt.Sprintf("at %s is not one of repo %q's listed commits", shortSHA(ref.At), ref.Repo),
				"set `at` to a full SHA from the repo's commits (not WORKTREE), or remove it")

			return "", false
		}

		state = ref.At
		c.result.StateKind = stateKindAt
	case node != nil && node.Change == review.ChangeDeleted:
		state = StateInitial
		c.result.StateKind = stateKindInitial
	}

	c.result.State = c.repo.StateSHA(state)

	return state, true
}

// checkCommit verifies a commit ref names one of the listed commits; the
// result's state becomes the full SHA.
func (c *refCheck) checkCommit() {
	index := slices.IndexFunc(c.repo.Commits, func(sha string) bool { return strings.HasPrefix(sha, c.ref.SHA) })
	if index >= 0 {
		c.result.State = c.repo.Commits[index]

		return
	}

	c.fail("commit_not_listed", fmt.Sprintf("commit %s is not one of repo %q's listed commits", c.ref.SHA, c.ref.Repo),
		"point at a commit from the repo's `commits`, or add it there if it is part of the change")
}

// stateDescription names a state kind for messages.
func stateDescription(kind, at string) string {
	switch kind {
	case stateKindFinal:
		return "final state"
	case stateKindInitial:
		return "initial state"
	case stateKindAt:
		return "state at " + shortSHA(at)
	}

	return ""
}

// missingFileHint explains the likeliest reason a ref's file is missing in
// the state it was read in.
func missingFileHint(repo *RepoState, ref *review.Ref, node *review.Node) string {
	deletedNode := node != nil && node.Change == review.ChangeDeleted
	if renamed := repo.DiffByOld(ref.File); renamed != nil && renamed.Status == DiffRenamed {
		return fmt.Sprintf("the file was renamed to %s; reference it by its final path", renamed.Path)
	}

	fileDiff := repo.Diff(ref.File)
	deletedByChange := fileDiff != nil && fileDiff.Status == DiffDeleted
	if deletedByChange && node != nil && !deletedNode {
		return "the file is deleted by the change; mark the node `deleted` to read it in the initial state"
	}

	if deletedNode {
		return "deleted nodes are read in the initial state; the file did not exist there"
	}

	return "check the path; it is repo-relative"
}

// checkLineBounds rejects line-based refs into binary files and ranges past
// the end of the file; ok is false when it failed the ref.
func (c *refCheck) checkLineBounds(content *Content) bool {
	ref := c.ref
	if content.Binary {
		c.fail("binary_file", fmt.Sprintf("%s is a binary file; it can only be referenced with a `file` ref", ref.File),
			"use { \"type\": \"file\", ... } for binary files")

		return false
	}

	// A site past the end is reported by checkSite, which names the line.
	last := len(content.Lines)
	if ref.Type != review.RefSite && ref.End() > last {
		c.fail("range_out_of_bounds", fmt.Sprintf("lines %d-%d end past the last line (%d) of %s", ref.Start(), ref.End(), last, ref.File),
			fmt.Sprintf("the file has %d lines in this state; adjust the range", last))

		return false
	}

	return true
}

// checkByType runs the checks specific to the ref type. Change states are
// only checked for node refs in the final or initial state.
func (c *refCheck) checkByType(content *Content) {
	ref, node := c.ref, c.node
	checksChange := node != nil && ref.At == ""
	switch ref.Type {
	case review.RefFile:
		if checksChange {
			c.checkFileChange()
		}
	case review.RefRange:
		if checksChange {
			c.checkRangeChange()
		}
	case review.RefSite:
		c.checkSite(content)
	case review.RefHunk:
		c.checkHunk()
		unchangedNodeOnHunk := node != nil && node.Change == review.ChangeUnchanged && c.result.Status == review.StatusVerified
		if unchangedNodeOnHunk {
			c.fail("change_mismatch", fmt.Sprintf("node %q is marked unchanged but references a hunk of the diff", node.ID),
				"mark the node with the change it makes, or use a `range` ref")
		}
	}
}

// failChangedContextNode fails a changed node pointing into a context repo,
// which has no diff. ok is true when the repo is a context repo, so that
// no diff checks apply.
func (c *refCheck) failChangedContextNode() bool {
	repo, node := c.repo, c.node
	if !repo.Repo.IsContext() {
		return false
	}

	if node.IsChanged() {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked %s but repo %q is a context repo with no diff", node.ID, node.Change, repo.Repo.ID),
			"refs into context repos never count as changed; mark the node unchanged or list the repo as changed")
	}

	return true
}

func (c *refCheck) checkFileChange() {
	if c.failChangedContextNode() {
		return
	}

	node, file := c.node, c.ref.File
	fileDiff := c.repo.Diff(file)
	if node.Change == review.ChangeUnchanged {
		if fileDiff != nil {
			c.fail("change_mismatch", fmt.Sprintf("node %q is marked unchanged but %s is %s in the diff", node.ID, file, fileDiff.Status),
				fmt.Sprintf("mark the node %s, or point it at an unchanged file", fileDiff.ChangeState()))
		}

		return
	}

	if fileDiff == nil {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked %s but %s is not in the diff", node.ID, node.Change, file),
			"mark the node unchanged, or check that the change is in the listed commits/WORKTREE")

		return
	}

	if fileDiff.ChangeState() != node.Change {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked %s but %s is %s in the diff", node.ID, node.Change, file, fileDiff.Status),
			fmt.Sprintf("mark the node %s", fileDiff.ChangeState()))
	}
}

func (c *refCheck) checkRangeChange() {
	if c.failChangedContextNode() {
		return
	}

	switch c.node.Change {
	case review.ChangeUnchanged:
		c.checkUnchangedRange()
	case review.ChangeAdded, review.ChangeModified:
		c.checkChangedRange()
	case review.ChangeDeleted:
		c.checkDeletedRange()
	}
}

// checkUnchangedRange requires no changed line strictly inside the range.
func (c *refCheck) checkUnchangedRange() {
	node := c.node
	start, end := c.ref.Lines[0], c.ref.Lines[1]
	fileDiff := c.repo.Diff(c.ref.File)
	if fileDiff == nil {
		return
	}

	if lines := changedInRange(fileDiff, start, end, true); len(lines) > 0 {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked unchanged but lines %s inside %d-%d changed", node.ID, runsText(lines), start, end),
			"mark the node modified, or narrow the range to unchanged lines")
	}
}

// checkChangedRange requires an added or modified range to hold a changed
// line, and a modified one to be in a file that existed before.
func (c *refCheck) checkChangedRange() {
	node, file := c.node, c.ref.File
	start, end := c.ref.Lines[0], c.ref.Lines[1]
	fileDiff := c.repo.Diff(file)
	if fileDiff == nil {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked %s but %s has no change in the diff", node.ID, node.Change, file),
			"mark the node unchanged, or point the range at changed lines")

		return
	}

	if node.Change == review.ChangeModified && fileDiff.Status == DiffAdded {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked modified but %s is a new file", node.ID, file),
			"mark the node added")

		return
	}

	if len(changedInRange(fileDiff, start, end, false)) == 0 {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked %s but lines %d-%d have no changed line", node.ID, node.Change, start, end),
			fmt.Sprintf("the diff changes %s of this file; adjust the range or the change state", linesWord(hunksText(fileDiff))))
	}
}

// checkDeletedRange requires a deleted range, in initial-state numbers, to
// hold a removed line.
func (c *refCheck) checkDeletedRange() {
	node, file := c.node, c.ref.File
	start, end := c.ref.Lines[0], c.ref.Lines[1]
	fileDiff := c.repo.Diff(file)
	if fileDiff == nil {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked deleted but %s has no change in the diff", node.ID, file),
			"mark the node unchanged, or point the range at removed lines (initial-state numbers)")

		return
	}

	removed := 0
	for _, hunk := range fileDiff.Hunks {
		removed += overlap(hunk.OldStart, hunk.OldEnd(), start, end)
	}

	if removed == 0 {
		c.fail("change_mismatch", fmt.Sprintf("node %q is marked deleted but initial-state lines %d-%d contain no removed line", node.ID, start, end),
			fmt.Sprintf("removed lines in the initial state: %s; adjust the range or the change state", oldHunksText(fileDiff)))
	}
}

func (c *refCheck) checkSite(content *Content) {
	ref := c.ref
	lines := content.Lines
	holdsNeedle := func(lineNumber int) bool {
		return lineNumber >= 1 && lineNumber <= len(lines) && strings.Contains(lines[lineNumber-1], ref.Contains)
	}
	if holdsNeedle(ref.Line) {
		return
	}

	for _, drift := range siteDrift {
		actual := ref.Line + drift
		if !holdsNeedle(actual) {
			continue
		}

		c.result.ActualLine = actual
		c.record("site_offset", fmt.Sprintf("%q is on line %d, not %d", ref.Contains, actual, ref.Line),
			fmt.Sprintf("set line to %d", actual))

		return
	}

	if ref.Line > len(lines) {
		c.fail("range_out_of_bounds", fmt.Sprintf("line %d is past the last line (%d) of %s", ref.Line, len(lines), ref.File),
			"point the site at an existing line")

		return
	}

	hint := "point `line` at the line holding `contains`, or fix `contains` (exact, case and whitespace as written)"
	if found := findLines(lines, ref.Contains, maxSiteSuggestions); len(found) > 0 {
		hint = fmt.Sprintf("%q appears on line %s", ref.Contains, joinInts(found))
	}

	c.fail("site_mismatch", fmt.Sprintf("%q not found on line %d of %s (±2 lines)", ref.Contains, ref.Line, ref.File), hint)
}

func (c *refCheck) checkHunk() {
	fileDiff := c.repo.Diff(c.ref.File)
	start, end := c.ref.Lines[0], c.ref.Lines[1]
	touched := fileDiff != nil && slices.ContainsFunc(fileDiff.Hunks, func(hunk *Hunk) bool {
		return hunkTouches(hunk, start, end)
	})
	if touched {
		return
	}

	hint := "no hunk of the diff touches this file"
	if fileDiff != nil {
		hint = fmt.Sprintf("hunks in this file: %s", hunksText(fileDiff))
	}

	c.fail("hunk_not_found", fmt.Sprintf("no hunk of %s overlaps lines %d-%d", c.ref.File, start, end), hint)
}

// hunkTouches reports whether a hunk ref's final-state lines [start,end]
// meet the hunk; a pure deletion matches by initial-state overlap or by
// touching the line before the removal.
func hunkTouches(hunk *Hunk, start, end int) bool {
	if hunk.PureDeletion() {
		return overlap(hunk.OldStart, hunk.OldEnd(), start, end) > 0 || touchesDeletion(hunk, start, end)
	}

	return overlap(hunk.NewStart, hunk.NewEnd(), start, end) > 0
}

// changedInRange lists final-state lines in [start,end] that the diff adds.
// A pure deletion counts at the line before it; strict requires it to sit
// strictly inside the range.
func changedInRange(fileDiff *FileDiff, start, end int, strict bool) []int {
	var changed []int
	for _, hunk := range fileDiff.Hunks {
		if hunk.PureDeletion() {
			anchor := hunk.NewStart
			inside := touchesDeletion(hunk, start, end)
			if strict {
				inside = start <= anchor && anchor+1 <= end
			}

			if inside {
				changed = append(changed, max(anchor, start))
			}

			continue
		}

		for line := max(hunk.NewStart, start); line <= min(hunk.NewEnd(), end); line++ {
			changed = append(changed, line)
		}
	}

	return changed
}

// touchesDeletion reports whether [start,end] includes the line before a
// pure deletion or the line after it.
func touchesDeletion(hunk *Hunk, start, end int) bool {
	anchor := hunk.NewStart

	return start <= anchor+1 && anchor <= end
}

// overlap counts the lines two inclusive ranges share.
func overlap(startA, endA, startB, endB int) int {
	low, high := max(startA, startB), min(endA, endB)
	if high < low {
		return 0
	}

	return high - low + 1
}

// hunksText lists a file's hunks in final-state numbers for hints.
func hunksText(fileDiff *FileDiff) string {
	var parts []string
	for i, hunk := range fileDiff.Hunks {
		if i == maxListedHunks {
			parts = append(parts, "…")

			break
		}

		switch {
		case hunk.PureDeletion():
			parts = append(parts, fmt.Sprintf("removal after %d", hunk.NewStart))
		case hunk.NewCount == 1:
			parts = append(parts, strconv.Itoa(hunk.NewStart))
		default:
			parts = append(parts, fmt.Sprintf("%d-%d", hunk.NewStart, hunk.NewEnd()))
		}
	}

	if len(parts) == 0 {
		return "(none)"
	}

	return strings.Join(parts, ", ")
}

// linesWord prefixes a list of line numbers and ranges with line or lines.
func linesWord(list string) string {
	single := !strings.ContainsAny(list, ",-") && !strings.HasPrefix(list, "removal")
	if single {
		return "line " + list
	}

	return "lines " + list
}

// oldHunksText lists the initial-state lines a file's hunks remove.
func oldHunksText(fileDiff *FileDiff) string {
	var parts []string
	for _, hunk := range fileDiff.Hunks {
		if hunk.OldCount > 0 {
			parts = append(parts, fmt.Sprintf("%d-%d", hunk.OldStart, hunk.OldEnd()))
		}
	}

	if len(parts) == 0 {
		return "(none)"
	}

	return strings.Join(parts, ", ")
}

// runs groups sorted line numbers into [start, end] runs.
func runs(lines []int) [][2]int {
	var grouped [][2]int
	for _, line := range lines {
		last := len(grouped) - 1
		extendsLast := last >= 0 && grouped[last][1]+1 >= line
		if extendsLast {
			grouped[last][1] = max(grouped[last][1], line)

			continue
		}

		grouped = append(grouped, [2]int{line, line})
	}

	return grouped
}

func runsText(lines []int) string {
	var parts []string
	for _, run := range runs(lines) {
		parts = append(parts, rangeText(run))
	}

	return strings.Join(parts, ", ")
}

// findLines lists, up to limit, the 1-based lines that contain needle.
func findLines(lines []string, needle string, limit int) []int {
	var found []int
	for i, line := range lines {
		if !strings.Contains(line, needle) {
			continue
		}

		found = append(found, i+1)
		if len(found) == limit {
			break
		}
	}

	return found
}

func joinInts(numbers []int) string {
	texts := make([]string, len(numbers))
	for i, number := range numbers {
		texts[i] = strconv.Itoa(number)
	}

	return strings.Join(texts, ", ")
}
