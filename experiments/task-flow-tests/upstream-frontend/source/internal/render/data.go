// Package render turns a checked review into one self-contained HTML page.
package render

import (
	"cmp"
	"fmt"
	"path/filepath"
	"slices"
	"time"

	"github.com/gtindo/task-view/internal/engine"
	"github.com/gtindo/task-view/internal/gitx"
	"github.com/gtindo/task-view/internal/langs"
	"github.com/gtindo/task-view/internal/review"
)

// Row is one line of a code excerpt or hunk as the page draws it. The JSON
// keys are one letter because a page can carry thousands of rows.
type Row struct {
	Type    string `json:"t"`           // rowContext, rowAdded, rowRemoved or rowGap
	Old     int    `json:"o,omitempty"` // initial-state line number
	New     int    `json:"n,omitempty"` // final-state (or read-state) line number
	HTML    string `json:"h"`           // highlighted HTML
	InRange bool   `json:"f,omitempty"` // inside the referenced range
}

// Row types, as app.js expects them.
const (
	rowContext = "ctx"
	rowAdded   = "add"
	rowRemoved = "del"
	rowGap     = "gap"
)

type excerpt struct {
	Repo      string `json:"repo"`
	File      string `json:"file"`
	OldPath   string `json:"oldPath,omitempty"`
	Language  string `json:"language,omitempty"`
	State     string `json:"state"`
	StateKind string `json:"stateKind"`
	Rows      []Row  `json:"rows"`
	Note      string `json:"note,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	// After is the whole final file for a `file` ref whose rows show only
	// its hunks; for other refs the page drops the removed rows instead.
	After          []Row `json:"after,omitempty"`
	AfterTruncated bool  `json:"afterTruncated,omitempty"`
}

type commitView struct {
	SHA      string `json:"sha"`
	Short    string `json:"short"`
	Subject  string `json:"subject"`
	Author   string `json:"author,omitempty"`
	Date     string `json:"date,omitempty"`
	Worktree bool   `json:"worktree,omitempty"`
}

type repoView struct {
	ID          string       `json:"id"`
	Path        string       `json:"path"`
	Abs         string       `json:"abs"`
	Role        string       `json:"role"`
	OK          bool         `json:"ok"`
	Worktree    bool         `json:"worktree"`
	Commits     []commitView `json:"commits"`
	Base        *commitView  `json:"base,omitempty"`
	Files       int          `json:"files"`
	Added       int          `json:"added"`
	Removed     int          `json:"removed"`
	Uncommitted []string     `json:"uncommitted,omitempty"`
}

type metaPair struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type nodeView struct {
	ID      string            `json:"id"`
	Kind    string            `json:"kind"`
	Label   string            `json:"label"`
	Change  string            `json:"change"`
	Why     string            `json:"why,omitempty"`
	Meta    []metaPair        `json:"meta,omitempty"`
	Ref     *review.Ref       `json:"ref,omitempty"`
	Result  *engine.RefResult `json:"result"`
	Excerpt string            `json:"excerpt,omitempty"`
	Context bool              `json:"context,omitempty"`
}

type edgeView struct {
	ID      string            `json:"id"`
	From    string            `json:"from"`
	To      string            `json:"to"`
	Kind    string            `json:"kind"`
	Ref     *review.Ref       `json:"ref,omitempty"`
	Result  *engine.RefResult `json:"result"`
	Excerpt string            `json:"excerpt,omitempty"`
}

type evidenceView struct {
	Ref     *review.Ref       `json:"ref"`
	Result  *engine.RefResult `json:"result"`
	Excerpt string            `json:"excerpt,omitempty"`
}

type claimView struct {
	Text     string         `json:"text"`
	About    []string       `json:"about"`
	Status   string         `json:"status"`
	Evidence []evidenceView `json:"evidence"`
}

type hunkView struct {
	ID        string   `json:"id"`
	OldStart  int      `json:"oldStart"`
	OldCount  int      `json:"oldCount"`
	NewStart  int      `json:"newStart"`
	NewCount  int      `json:"newCount"`
	Coverage  string   `json:"coverage"`
	Nodes     []string `json:"nodes"`
	TestNodes []string `json:"testNodes,omitempty"`
	Uncovered [][2]int `json:"uncovered,omitempty"`
	OldSide   bool     `json:"oldSide,omitempty"`
	Commits   []string `json:"commits,omitempty"`
	Rows      []Row    `json:"rows"`
}

type fileView struct {
	ID        string     `json:"id"`
	Repo      string     `json:"repo"`
	Path      string     `json:"path"`
	OldPath   string     `json:"oldPath,omitempty"`
	Status    string     `json:"status"`
	Binary    bool       `json:"binary,omitempty"`
	Untracked bool       `json:"untracked,omitempty"`
	Language  string     `json:"language,omitempty"`
	Added     int        `json:"added"`
	Removed   int        `json:"removed"`
	Lines     int        `json:"lines"`
	Coverage  string     `json:"coverage"`
	FileNodes []string   `json:"fileNodes,omitempty"`
	HasTests  bool       `json:"hasTests,omitempty"`
	Hunks     []hunkView `json:"hunks"`
}

type viewData struct {
	Version    string                `json:"version"`
	Generated  string                `json:"generated"`
	ReviewPath string                `json:"reviewPath"`
	ReviewName string                `json:"reviewName"`
	ExitCode   int                   `json:"exitCode"`
	Summary    string                `json:"summary"`
	Notes      []string              `json:"notes"`
	Repos      []repoView            `json:"repos"`
	Nodes      []nodeView            `json:"nodes"`
	Edges      []edgeView            `json:"edges"`
	Flows      []*review.Flow        `json:"flows"`
	Claims     []claimView           `json:"claims"`
	Files      []fileView            `json:"files"`
	Excerpts   map[string]*excerpt   `json:"excerpts"`
	Errors     []review.Finding      `json:"errors"`
	Warnings   []review.Finding      `json:"warnings"`
	Counts     engine.Summary        `json:"counts"`
	Unlisted   []engine.UnlistedRepo `json:"unlisted"`
}

const (
	// ctxLines is how many unchanged lines frame a referenced range or hunk.
	ctxLines = 3
	// siteCtxLines frames a site ref more widely than ctxLines: a site is a
	// single line, which says little without its surroundings.
	siteCtxLines = 4
	// maxRows caps one excerpt or hunk so a huge file cannot bloat the page.
	maxRows = 600
	// shortSHALen matches Git's default abbreviated commit length.
	shortSHALen = 7
)

// Values of engine.RefResult.StateKind other than the final state.
const (
	stateKindInitial = "initial"
	stateKindAt      = "at"
)

// builder collects page data for one engine run. It owns the excerpts and a
// highlight cache, since nodes, edges, claims and files often show the same
// file in the same state.
type builder struct {
	run            *engine.Engine
	highlightCache map[string][]string
	excerpts       map[string]*excerpt
}

func build(run *engine.Engine, version string) *viewData {
	pageBuilder := &builder{
		run:            run,
		highlightCache: map[string][]string{},
		excerpts:       map[string]*excerpt{},
	}
	rev := run.Review
	errs, warns := review.Split(run.Findings)

	view := &viewData{
		Version:    version,
		Generated:  time.Now().Format(time.RFC3339),
		ReviewPath: run.ReviewPath,
		ReviewName: filepath.Base(run.ReviewPath),
		ExitCode:   run.ExitCode,
		Summary:    rev.Summary,
		Notes:      nonNil(rev.Notes),
		Edges:      []edgeView{},
		Flows:      nonNil(rev.Flows),
		Claims:     []claimView{},
		Files:      []fileView{},
		Excerpts:   pageBuilder.excerpts,
		Errors:     errs,
		Warnings:   warns,
		Counts:     run.Summary,
		Unlisted:   run.Unlisted,
	}

	for _, repoState := range run.Repos {
		view.Repos = append(view.Repos, pageBuilder.repo(repoState))
	}

	for i, node := range rev.Nodes {
		view.Nodes = append(view.Nodes, pageBuilder.node(node, run.NodeResults[i]))
	}

	for i, edge := range rev.Edges {
		view.Edges = append(view.Edges, pageBuilder.edge(i, edge, run.EdgeResults[i]))
	}

	for i, claim := range rev.Claims {
		view.Claims = append(view.Claims, pageBuilder.claim(i, claim, run.ClaimResults[i]))
	}

	for _, repoState := range run.Repos {
		for i, coverage := range run.Coverage[repoState.Repo.ID] {
			id := fmt.Sprintf("f:%s:%d", repoState.Repo.ID, i)
			view.Files = append(view.Files, pageBuilder.file(repoState, coverage, id))
		}
	}

	return view
}

// nonNil makes a nil list encode as [] rather than null in the page data.
func nonNil[Item any](items []Item) []Item {
	if items == nil {
		return []Item{}
	}

	return items
}

func (b *builder) node(node *review.Node, result *engine.RefResult) nodeView {
	pageNode := nodeView{
		ID:     node.ID,
		Kind:   node.Kind,
		Label:  node.Label,
		Change: node.Change,
		Why:    node.Why,
		Ref:    node.Ref,
		Result: result,
	}

	for _, meta := range node.Meta {
		pageNode.Meta = append(pageNode.Meta, metaPair{Key: meta.Key, Value: meta.String()})
	}

	if node.Ref == nil {
		return pageNode
	}

	refRepo := b.run.Repo(node.Ref.Repo)
	pageNode.Context = refRepo != nil && refRepo.Repo.IsContext()

	id := "n:" + node.ID
	if b.excerpt(id, node.Ref, result) {
		pageNode.Excerpt = id
	}

	return pageNode
}

func (b *builder) edge(edgeIndex int, edge *review.Edge, result *engine.RefResult) edgeView {
	pageEdge := edgeView{
		ID:     fmt.Sprintf("e%d", edgeIndex),
		From:   edge.From,
		To:     edge.To,
		Kind:   edge.Kind,
		Ref:    edge.Ref,
		Result: result,
	}

	if edge.Ref == nil {
		return pageEdge
	}

	id := "e:" + pageEdge.ID
	if b.excerpt(id, edge.Ref, result) {
		pageEdge.Excerpt = id
	}

	return pageEdge
}

func (b *builder) claim(claimIndex int, claim *review.Claim, result *engine.ClaimResult) claimView {
	pageClaim := claimView{
		Text:     claim.Text,
		About:    nonNil(claim.About),
		Status:   result.Status,
		Evidence: []evidenceView{},
	}

	for j, ref := range claim.Evidence {
		evidenceResult := result.Evidence[j]
		pageEvidence := evidenceView{Ref: ref, Result: evidenceResult}

		id := fmt.Sprintf("c:%d:%d", claimIndex, j)
		if b.excerpt(id, ref, evidenceResult) {
			pageEvidence.Excerpt = id
		}

		pageClaim.Evidence = append(pageClaim.Evidence, pageEvidence)
	}

	return pageClaim
}

func (b *builder) repo(repoState *engine.RepoState) repoView {
	view := repoView{
		ID:          repoState.Repo.ID,
		Path:        repoState.Repo.Path,
		Abs:         repoState.Abs,
		Role:        repoState.Repo.Role,
		OK:          repoState.OK,
		Worktree:    repoState.Worktree,
		Commits:     []commitView{},
		Uncommitted: b.run.Uncommitted[repoState.Repo.ID],
	}

	if repoState.Worktree {
		view.Commits = append(view.Commits, commitView{
			SHA:      review.Worktree,
			Short:    "WORKTREE",
			Subject:  "Uncommitted changes in the working tree",
			Worktree: true,
		})
	}

	for _, sha := range repoState.Commits {
		view.Commits = append(view.Commits, commitInfo(repoState, sha))
	}

	// A broken repo resolved no commits, so list the review's own SHAs to
	// show what it asked for.
	if !repoState.OK {
		for _, sha := range repoState.Repo.Commits {
			if sha == review.Worktree {
				continue
			}

			view.Commits = append(view.Commits, commitView{SHA: sha, Short: shortSHA(sha), Subject: "(unresolved)"})
		}
	}

	hasBase := repoState.OK && !repoState.Repo.IsContext()
	if hasBase {
		if repoState.Initial == gitx.EmptyTree {
			view.Base = &commitView{
				SHA:     repoState.Initial,
				Short:   "∅",
				Subject: "empty tree (change starts at the root commit)",
			}
		} else {
			base := commitInfo(repoState, repoState.Initial)
			view.Base = &base
		}
	}

	for _, file := range repoState.Files {
		view.Files++
		view.Added += file.Added()
		view.Removed += file.Removed()
	}

	return view
}

func commitInfo(repoState *engine.RepoState, sha string) commitView {
	info, ok := repoState.CommitLog[sha]
	if !ok {
		return commitView{SHA: sha, Short: shortSHA(sha)}
	}

	return commitView{
		SHA:     sha,
		Short:   info.Short,
		Subject: info.Subject,
		Author:  info.Author,
		Date:    info.Date,
	}
}

func shortSHA(sha string) string {
	if len(sha) > shortSHALen {
		return sha[:shortSHALen]
	}

	return sha
}

// highlighted returns the highlighted lines of a file in a state, with the
// content they came from.
func (b *builder) highlighted(repoState *engine.RepoState, state, path, language string) ([]string, *engine.Content) {
	content := repoState.Read(state, path)

	// NUL cannot occur in a repo id, SHA or path, so the key is unambiguous.
	key := repoState.Repo.ID + "\x00" + repoState.StateSHA(state) + "\x00" + path + "\x00" + language
	if lines, ok := b.highlightCache[key]; ok {
		return lines, content
	}

	lines := langs.Highlight(content.Lines, language)
	b.highlightCache[key] = lines

	return lines, content
}

// renamedFrom is the initial path of a renamed file, or "" when the path did
// not change.
func renamedFrom(diff *engine.FileDiff) string {
	if diff.OldPath == diff.Path {
		return ""
	}

	return diff.OldPath
}

// lineSpan is an inclusive range of line numbers.
type lineSpan struct {
	first, last int
}

// noFocus highlights no line: it is empty, as last is before first.
var noFocus = lineSpan{first: 0, last: -1}

func (s lineSpan) contains(line int) bool {
	return line >= s.first && line <= s.last
}

// hunkContext is the final-line window that shows a hunk with ctxLines of
// context, before clamping to the file. A pure deletion sits between
// NewStart and NewStart+1, so its window is centred there.
func hunkContext(hunk *engine.Hunk) (from, to int) {
	if hunk.PureDeletion() {
		return hunk.NewStart - ctxLines + 1, hunk.NewStart + ctxLines
	}

	return hunk.NewStart - ctxLines, hunk.NewEnd() + ctxLines
}

// removedLines returns the hunk's removed initial lines and the final line
// they are shown before. A pure deletion has no new lines and its NewStart
// is the line before the gap, so they go before the next line.
func removedLines(hunk *engine.Hunk) (anchor int, lines []int) {
	anchor = hunk.NewStart
	if hunk.PureDeletion() {
		anchor = hunk.NewStart + 1
	}

	for line := hunk.OldStart; line <= hunk.OldEnd(); line++ {
		lines = append(lines, line)
	}

	return anchor, lines
}

// diffIndex precomputes, for a file diff, which final lines are added,
// which removed lines sit before each final line, and the old-number offset.
type diffIndex struct {
	added         map[int]bool
	removedBefore map[int][]int // final line before which removed (old) lines are shown
	hunks         []*engine.Hunk
}

func indexDiff(diff *engine.FileDiff) *diffIndex {
	index := &diffIndex{added: map[int]bool{}, removedBefore: map[int][]int{}}
	if diff == nil {
		return index
	}

	index.hunks = diff.Hunks
	for _, hunk := range diff.Hunks {
		for line := hunk.NewStart; line <= hunk.NewEnd(); line++ {
			index.added[line] = true
		}

		anchor, removed := removedLines(hunk)
		index.removedBefore[anchor] = append(index.removedBefore[anchor], removed...)
	}

	return index
}

// oldNumber maps an unchanged final line onto its initial-state number.
func (index *diffIndex) oldNumber(line int) int {
	offset := 0
	for _, hunk := range index.hunks {
		hunkAbove := hunk.NewEnd() < line
		if hunk.PureDeletion() {
			hunkAbove = hunk.NewStart < line
		}

		if hunkAbove {
			offset += hunk.NewCount - hunk.OldCount
		}
	}

	return line - offset
}

// diffRows renders final lines [from, to] with removed lines interleaved.
func diffRows(newLines, oldLines []string, index *diffIndex, from, to int, focus lineSpan) []Row {
	var rows []Row
	for line := from; line <= to+1; line++ {
		// Removed lines just past the window belong to it when they close
		// the focused range or the file.
		pastWindow := line > to
		closesFocusOrFile := line == focus.last+1 || line == len(newLines)+1
		if !pastWindow || closesFocusOrFile {
			// Removed lines right after the focused range are part of it.
			removedInFocus := line >= focus.first && line <= focus.last+1
			for _, oldLine := range index.removedBefore[line] {
				rows = append(rows, Row{
					Type:    rowRemoved,
					Old:     oldLine,
					HTML:    lineAt(oldLines, oldLine),
					InRange: removedInFocus,
				})
			}
		}

		if pastWindow {
			break
		}

		row := Row{Type: rowContext, New: line, HTML: lineAt(newLines, line), InRange: focus.contains(line)}
		if index.added[line] {
			row.Type = rowAdded
		} else {
			row.Old = index.oldNumber(line)
		}

		rows = append(rows, row)
	}

	return rows
}

func lineAt(lines []string, line int) string {
	if line >= 1 && line <= len(lines) {
		return lines[line-1]
	}

	return ""
}

// refState is the state a ref was resolved in, from its result's state kind.
func refState(ref *review.Ref, result *engine.RefResult) string {
	switch result.StateKind {
	case stateKindInitial:
		return engine.StateInitial
	case stateKindAt:
		return ref.At
	}

	return engine.StateFinal
}

// excerptSource is one file in one state, ready to cut into excerpt rows.
type excerptSource struct {
	state    string
	lines    []string // highlighted lines in state
	oldLines []string // highlighted initial lines, for removed rows
	diff     *engine.FileDiff
	index    *diffIndex
	// plain sources show the file as it is: a past state, a context repo or
	// an unchanged file has no final-state diff to interleave.
	plain bool
}

// window renders lines [from, to], clamped to the file and to maxRows;
// truncated reports the maxRows clamp.
func (src *excerptSource) window(from, to int, focus lineSpan) (rows []Row, truncated bool) {
	from, to = max(1, from), min(len(src.lines), to)
	if to-from+1 > maxRows {
		to = from + maxRows - 1
		truncated = true
	}

	if src.plain {
		return src.plainRows(from, to, focus), truncated
	}

	return diffRows(src.lines, src.oldLines, src.index, from, to, focus), truncated
}

// plainRows renders lines [from, to] without interleaving. In the initial
// state the numbers are initial ones, and lines the change removes are marked.
func (src *excerptSource) plainRows(from, to int, focus lineSpan) []Row {
	markRemoved := src.state == engine.StateInitial && src.diff != nil

	var rows []Row
	for line := from; line <= to; line++ {
		row := Row{Type: rowContext, New: line, HTML: src.lines[line-1], InRange: focus.contains(line)}
		if markRemoved {
			row.Old, row.New = line, 0
			removed := slices.ContainsFunc(src.diff.Hunks, func(hunk *engine.Hunk) bool {
				return line >= hunk.OldStart && line <= hunk.OldEnd()
			})
			if removed {
				row.Type = rowRemoved
			}
		}

		rows = append(rows, row)
	}

	return rows
}

// hunkRows renders every hunk with context, trimming windows that overlap
// the previous one and separating the others with a gap row.
func (src *excerptSource) hunkRows() (rows []Row, truncated bool) {
	prevEnd := 0
	for _, hunk := range src.diff.Hunks {
		from, to := hunkContext(hunk)
		from = max(1, from)

		switch {
		case from <= prevEnd:
			from = prevEnd + 1
		case prevEnd > 0:
			rows = append(rows, Row{Type: rowGap})
		}

		if to < from {
			continue
		}

		windowRows, windowTruncated := src.window(from, to, noFocus)
		rows = append(rows, windowRows...)
		truncated = truncated || windowTruncated
		prevEnd = min(to, len(src.lines))

		if len(rows) > maxRows {
			return rows, true
		}
	}

	return rows, truncated
}

// afterRows lists the whole final file with added lines marked, so the page
// can show the code after the change next to its hunks.
func (src *excerptSource) afterRows() (rows []Row, truncated bool) {
	for i, lineHTML := range src.lines {
		line := i + 1
		if line > maxRows {
			return rows, true
		}

		row := Row{Type: rowContext, New: line, HTML: lineHTML}
		if src.index.added[line] {
			row.Type = rowAdded
		}

		rows = append(rows, row)
	}

	return rows, false
}

// excerpt resolves the code a ref points at and stores it under id; it
// returns false when there is nothing to show.
func (b *builder) excerpt(id string, ref *review.Ref, result *engine.RefResult) bool {
	repoState := b.run.Repo(ref.Repo)
	pointsAtFile := repoState != nil && repoState.OK && ref.File != "" && result.State != ""
	if !pointsAtFile {
		return false
	}

	language := repoState.Language(ref.File, ref.Language)
	state := refState(ref, result)

	lines, content := b.highlighted(repoState, state, ref.File, language)
	if !content.Exists {
		return false
	}

	codeExcerpt := &excerpt{
		Repo:      ref.Repo,
		File:      ref.File,
		Language:  language,
		State:     result.State,
		StateKind: result.StateKind,
	}
	b.excerpts[id] = codeExcerpt

	if content.Binary {
		codeExcerpt.Note = "binary file"

		return true
	}

	diff := repoState.Diff(ref.File)
	if diff != nil {
		codeExcerpt.OldPath = renamedFrom(diff)
	}

	src := &excerptSource{
		state: state,
		lines: lines,
		diff:  diff,
		index: indexDiff(diff),
		plain: state != engine.StateFinal || repoState.Repo.IsContext() || diff == nil,
	}
	if !src.plain && diff.OldPath != "" {
		src.oldLines, _ = b.highlighted(repoState, engine.StateInitial, diff.OldPath, language)
	}

	switch ref.Type {
	case review.RefRange, review.RefHunk:
		focus := lineSpan{first: ref.Lines[0], last: ref.Lines[1]}
		codeExcerpt.Rows, codeExcerpt.Truncated = src.window(focus.first-ctxLines, focus.last+ctxLines, focus)
	case review.RefSite:
		line := ref.Line
		if result.ActualLine > 0 {
			line = result.ActualLine
		}

		focus := lineSpan{first: line, last: line}
		codeExcerpt.Rows, codeExcerpt.Truncated = src.window(line-siteCtxLines, line+siteCtxLines, focus)
	case review.RefFile:
		// A changed file shows only its hunks; an added file is all new, so
		// it is shown whole like an unchanged one.
		showsHunks := !src.plain && diff.Status != engine.DiffAdded && len(diff.Hunks) > 0
		if showsHunks {
			codeExcerpt.Rows, codeExcerpt.Truncated = src.hunkRows()
			codeExcerpt.After, codeExcerpt.AfterTruncated = src.afterRows()

			break
		}

		codeExcerpt.Rows, codeExcerpt.Truncated = src.window(1, len(src.lines), noFocus)
	}

	return true
}

func (b *builder) file(repoState *engine.RepoState, coverage *engine.FileCoverage, id string) fileView {
	diff := coverage.Diff
	language := repoState.Language(diff.Key(), "")

	view := fileView{
		ID:        id,
		Repo:      repoState.Repo.ID,
		Path:      diff.Key(),
		OldPath:   renamedFrom(diff),
		Status:    diff.Status,
		Binary:    diff.Binary,
		Untracked: diff.Untracked,
		Language:  language,
		Added:     diff.Added(),
		Removed:   diff.Removed(),
		Coverage:  coverage.Coverage,
		FileNodes: coverage.FileNodes,
		HasTests:  coverage.HasTests,
		Hunks:     []hunkView{},
	}

	deleted := diff.Status == engine.DiffDeleted

	var newLines, oldLines []string
	if !diff.Binary {
		if !deleted {
			newLines, _ = b.highlighted(repoState, engine.StateFinal, diff.Path, language)
		}

		if diff.OldPath != "" {
			oldLines, _ = b.highlighted(repoState, engine.StateInitial, diff.OldPath, language)
		}
	}

	view.Lines = len(newLines)
	if deleted {
		view.Lines = len(oldLines)
	}

	index := indexDiff(diff)
	for i, hunkCoverage := range coverage.Hunks {
		hunk := hunkCoverage.Hunk
		pageHunk := hunkView{
			ID:        fmt.Sprintf("%s:%d", id, i),
			OldStart:  hunk.OldStart,
			OldCount:  hunk.OldCount,
			NewStart:  hunk.NewStart,
			NewCount:  hunk.NewCount,
			Coverage:  hunkCoverage.Coverage,
			Nodes:     nonNil(hunkCoverage.Nodes),
			TestNodes: hunkCoverage.TestNodes,
			Uncovered: hunkCoverage.Uncovered,
			OldSide:   hunkCoverage.OldSide,
			Commits:   repoState.HunkCommits(diff.Path, hunk),
		}

		if deleted {
			pageHunk.Rows = deletedHunkRows(hunk, oldLines)
		} else {
			pageHunk.Rows = changedHunkRows(hunk, newLines, oldLines, index)
		}

		view.Hunks = append(view.Hunks, pageHunk)
	}

	slices.SortStableFunc(view.Hunks, func(left, right hunkView) int {
		return cmp.Compare(left.NewStart, right.NewStart)
	})

	return view
}

// deletedHunkRows renders a hunk of a deleted file: removed lines only, up
// to maxRows.
func deletedHunkRows(hunk *engine.Hunk, oldLines []string) []Row {
	var rows []Row
	for line := hunk.OldStart; line <= hunk.OldEnd() && len(rows) < maxRows; line++ {
		rows = append(rows, Row{Type: rowRemoved, Old: line, HTML: lineAt(oldLines, line)})
	}

	return rows
}

// changedHunkRows renders one hunk with context. It interleaves only this
// hunk's removed lines, so removals of a neighbouring hunk inside the
// context window stay with that hunk.
func changedHunkRows(hunk *engine.Hunk, newLines, oldLines []string, index *diffIndex) []Row {
	from, to := hunkContext(hunk)
	from, to = max(1, from), min(len(newLines), to)
	if to-from > maxRows {
		to = from + maxRows
	}

	anchor, removed := removedLines(hunk)
	hunkIndex := &diffIndex{
		added:         index.added,
		removedBefore: map[int][]int{anchor: removed},
		hunks:         index.hunks,
	}

	focus := lineSpan{first: hunk.NewStart, last: hunk.NewEnd()}

	return diffRows(newLines, oldLines, hunkIndex, from, to, focus)
}
