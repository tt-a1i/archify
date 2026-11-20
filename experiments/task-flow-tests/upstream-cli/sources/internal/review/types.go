// Package review holds the review file model, its embedded JSON Schema and
// the structural and cross-reference rules checked before any Git access.
package review

import "slices"

// SchemaVersion is the review file version this binary writes instructions for.
const SchemaVersion = 1

// SupportedVersions lists every review file version this binary can check.
var SupportedVersions = []int{1}

// Worktree is the commits entry that stands for uncommitted work on disk.
const Worktree = "WORKTREE"

// Change states a node can declare.
const (
	ChangeAdded     = "added"
	ChangeModified  = "modified"
	ChangeDeleted   = "deleted"
	ChangeUnchanged = "unchanged"
)

// Repo roles.
const (
	RoleChanged = "changed"
	RoleContext = "context"
)

// Reference types.
const (
	RefFile   = "file"
	RefRange  = "range"
	RefSite   = "site"
	RefHunk   = "hunk"
	RefCommit = "commit"
)

// Review is the whole review file.
type Review struct {
	// Schema is the optional `$schema` URL editors use to check the file.
	// The JSON Schema allows it, so the strict decoder must know it too.
	Schema  string   `json:"$schema,omitempty"`
	Version int      `json:"version"`
	Summary string   `json:"summary"`
	Repos   []*Repo  `json:"repos"`
	Nodes   []*Node  `json:"nodes"`
	Edges   []*Edge  `json:"edges,omitempty"`
	Flows   []*Flow  `json:"flows,omitempty"`
	Claims  []*Claim `json:"claims,omitempty"`
	Notes   []string `json:"notes,omitempty"`
}

// Repo is one local repository taking part in the change.
type Repo struct {
	ID        string     `json:"id"`
	Path      string     `json:"path"`
	Role      string     `json:"role,omitempty"`
	Commits   []string   `json:"commits"`
	Languages OrderedMap `json:"languages,omitempty"`
}

// IsContext reports whether the agent only read this repo.
func (r *Repo) IsContext() bool { return r.Role == RoleContext }

// Node is one meaningful piece of the change.
type Node struct {
	ID     string     `json:"id"`
	Kind   string     `json:"kind"`
	Label  string     `json:"label"`
	Change string     `json:"change"`
	Ref    *Ref       `json:"ref,omitempty"`
	Why    string     `json:"why,omitempty"`
	Meta   OrderedMap `json:"meta,omitempty"`
}

// IsTest reports whether the node is a test case.
func (n *Node) IsTest() bool { return n.Kind == "test" }

// EdgeTests is the edge kind that ties a test node to the code it exercises.
const EdgeTests = "tests"

// flowSubjectKinds are the node kinds that run when a flow runs: every added
// or modified one must be on a flow.
var flowSubjectKinds = []string{"code", "component", "entry"}

// offFlowKinds never sit on a flow: tests reach code through `tests` edges,
// and docs, config and import lines do not run.
var offFlowKinds = []string{"test", "imports", "doc", "docs", "config"}

// IsFlowSubject reports whether the node is code a flow walks through.
func (n *Node) IsFlowSubject() bool { return slices.Contains(flowSubjectKinds, n.Kind) }

// CanBeFlowStep reports whether the node may be a step of a flow.
func (n *Node) CanBeFlowStep() bool { return !slices.Contains(offFlowKinds, n.Kind) }

// IsChanged reports whether the node declares a change.
func (n *Node) IsChanged() bool { return n.Change != ChangeUnchanged }

// Edge is a relation between two nodes.
type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
	Ref  *Ref   `json:"ref,omitempty"`
}

// Flow is what one entry reaches through the change: Path lists the flow's
// nodes, entry first, and the edges between them give it its shape, so a
// flow branches wherever the entry leads to several chains. Tests stays for
// older files; tests reach code through `tests` edges instead.
type Flow struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	Path  []string `json:"path"`
	Tests []string `json:"tests,omitempty"`
}

// Claim is a statement backed by evidence refs.
type Claim struct {
	Text     string   `json:"text"`
	About    []string `json:"about,omitempty"`
	Evidence []*Ref   `json:"evidence,omitempty"`
}

// Ref points at a fact the tool can resolve.
type Ref struct {
	Type     string `json:"type"`
	Repo     string `json:"repo"`
	File     string `json:"file,omitempty"`
	Lines    []int  `json:"lines,omitempty"`
	Line     int    `json:"line,omitempty"`
	Contains string `json:"contains,omitempty"`
	SHA      string `json:"sha,omitempty"`
	At       string `json:"at,omitempty"`
	Language string `json:"language,omitempty"`
}

// hasLineSpan reports whether the ref gives its lines as a [start, end] pair.
func (r *Ref) hasLineSpan() bool { return len(r.Lines) == 2 }

// Start returns the first line the ref covers, or 0.
func (r *Ref) Start() int {
	switch {
	case r.hasLineSpan():
		return r.Lines[0]
	case r.Line > 0:
		return r.Line
	}

	return 0
}

// End returns the last line the ref covers, or 0.
func (r *Ref) End() int {
	switch {
	case r.hasLineSpan():
		return r.Lines[1]
	case r.Line > 0:
		return r.Line
	}

	return 0
}

// IsLineBased reports whether the ref addresses lines of a file.
func (r *Ref) IsLineBased() bool {
	return r.Type == RefRange || r.Type == RefSite || r.Type == RefHunk
}
