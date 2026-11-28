package filetree

import (
	"fmt"
	"github.com/wagoodman/dive/internal/log"
	"path"
	"strings"

	"github.com/google/uuid"
)

const (
	newLine              = "\n"
	noBranchSpace        = "    "
	branchSpace          = "│   "
	middleItem           = "├─"
	lastItem             = "└─"
	whiteoutPrefix       = ".wh."
	doubleWhiteoutPrefix = ".wh..wh.."
	uncollapsedItem      = "─ "
	collapsedItem        = "⊕ "
)

// FileTree represents a set of files, directories, and their relations.
type FileTree struct {
	Root      *FileNode
	Size      int
	FileSize  uint64
	Name      string
	Id        uuid.UUID
	SortOrder SortOrder
}

// NewFileTree creates an empty FileTree
func NewFileTree() (tree *FileTree) {
	tree = new(FileTree)
	tree.Size = 0
	tree.Root = new(FileNode)
	tree.Root.Tree = tree
	tree.Root.Children = make(map[string]*FileNode)
	tree.Id = uuid.New()
	tree.SortOrder = ByName
	return tree
}

// renderParams is a representation of a FileNode in the context of the greater tree. All
// data stored is necessary for rendering a single line in a tree format.
type renderParams struct {
	node          *FileNode
	spaces        []bool
	childSpaces   []bool
	showCollapsed bool
	isLast        bool
}

// renderStringTreeBetween returns a string representing the given tree between the given rows. Since each node
// is rendered on its own line, the returned string shows the visible nodes not affected by a collapsed parent.
func (tree *FileTree) renderStringTreeBetween(startRow, stopRow int, showAttributes bool) string {
	// generate a list of nodes to render
	var params = make([]renderParams, 0)
	var result string

	// visit from the front of the list
	var paramsToVisit = []renderParams{{node: tree.Root, spaces: []bool{}, showCollapsed: false, isLast: false}}
	for currentRow := 0; len(paramsToVisit) > 0 && currentRow <= stopRow; currentRow++ {
		// pop the first node
		var currentParams renderParams
		currentParams, paramsToVisit = paramsToVisit[0], paramsToVisit[1:]

		// take note of the next nodes to visit later
		sorter := GetSortOrderStrategy(tree.SortOrder)
		keys := sorter.orderKeys(currentParams.node.Children)

		var childParams = make([]renderParams, 0)
		for idx, name := range keys {
			child := currentParams.node.Children[name]
			// don't visit this node...
			if child.Data.ViewInfo.Hidden || currentParams.node.Data.ViewInfo.Collapsed {
				continue
			}

			// visit this node...
			isLast := idx == (len(currentParams.node.Children) - 1)
			showCollapsed := child.Data.ViewInfo.Collapsed && len(child.Children) > 0

			// completely copy the reference slice
			childSpaces := make([]bool, len(currentParams.childSpaces))
			copy(childSpaces, currentParams.childSpaces)

			if len(child.Children) > 0 && !child.Data.ViewInfo.Collapsed {
				childSpaces = append(childSpaces, isLast)
			}

			childParams = append(childParams, renderParams{
				node:          child,
				spaces:        currentParams.childSpaces,
				childSpaces:   childSpaces,
				showCollapsed: showCollapsed,
				isLast:        isLast,
			})
		}
		// keep the child nodes to visit later
		paramsToVisit = append(childParams, paramsToVisit...)

		// never process the root node
		if currentParams.node == tree.Root {
			currentRow--
			continue
		}

		// process the current node
		if currentRow >= startRow && currentRow <= stopRow {
			params = append(params, currentParams)
		}
	}

	// render the result
	for idx := range params {
		currentParams := params[idx]

		if showAttributes {
			result += currentParams.node.MetadataString() + " "
		}
		result += currentParams.node.renderTreeLine(currentParams.spaces, currentParams.isLast, currentParams.showCollapsed)
	}

	return result
}

func (tree *FileTree) VisibleSize() int {
	var size int

	visitor := func(node *FileNode) error {
		size++
		return nil
	}
	visitEvaluator := func(node *FileNode) bool {
		if node.Data.FileInfo.IsDir {
			// we won't visit a collapsed dir, but we need to count it
			if node.Data.ViewInfo.Collapsed {
				size++
			}
			return !node.Data.ViewInfo.Collapsed && !node.Data.ViewInfo.Hidden
		}
		return !node.Data.ViewInfo.Hidden
	}
	err := tree.VisitDepthParentFirst(visitor, visitEvaluator)
	if err != nil {
		log.WithFields("error", err).Debug("unable to determine visible tree size")
	}

	// don't include root
	size--

	return size
}

// String returns the entire tree in an ASCII representation.
func (tree *FileTree) String(showAttributes bool) string {
	return tree.renderStringTreeBetween(0, tree.Size, showAttributes)
}

// StringBetween returns a partial tree in an ASCII representation.
func (tree *FileTree) StringBetween(start, stop int, showAttributes bool) string {
	return tree.renderStringTreeBetween(start, stop, showAttributes)
}

// Copy returns a copy of the given FileTree
func (tree *FileTree) Copy() *FileTree {
	newTree := NewFileTree()
	newTree.Size = tree.Size
	newTree.FileSize = tree.FileSize
	newTree.Root = tree.Root.Copy(newTree.Root)
	newTree.SortOrder = tree.SortOrder

	// update the tree pointers
	err := newTree.VisitDepthChildFirst(func(node *FileNode) error {
		node.Tree = newTree
		return nil
	}, nil)

	if err != nil {
		log.WithFields("error", err).Debug("unable to propagate tree on copy")
	}

	return newTree
}

// Visitor is a function that processes, observes, or otherwise transforms the given node
type Visitor func(*FileNode) error

// VisitEvaluator is a function that indicates whether the given node should be visited by a Visitor.
type VisitEvaluator func(*FileNode) bool

// VisitDepthChildFirst iterates the given tree depth-first, evaluating the deepest depths first (visit on bubble up)
func (tree *FileTree) VisitDepthChildFirst(visitor Visitor, evaluator VisitEvaluator) error {
	sorter := GetSortOrderStrategy(tree.SortOrder)
	return tree.Root.VisitDepthChildFirst(visitor, evaluator, sorter)
}

// VisitDepthParentFirst iterates the given tree depth-first, evaluating the shallowest depths first (visit while sinking down)
func (tree *FileTree) VisitDepthParentFirst(visitor Visitor, evaluator VisitEvaluator) error {
	sorter := GetSortOrderStrategy(tree.SortOrder)
	return tree.Root.VisitDepthParentFirst(visitor, evaluator, sorter)
}

// Stack takes two trees and combines them together. This is done by "stacking" the given tree on top of the owning tree.
func (tree *FileTree) Stack(upper *FileTree) (failed []PathError, stackErr error) {
	graft := func(node *FileNode) error {
		if node.IsWhiteout() {
			err := tree.RemovePath(node.Path())
			if err != nil {
				failed = append(failed, NewPathError(node.Path(), ActionAdd, err))
			}
		} else {
			_, _, err := tree.AddPath(node.Path(), node.Data.FileInfo)
			if err != nil {
				failed = append(failed, NewPathError(node.Path(), ActionRemove, err))
			}
		}
		return nil
	}
	stackErr = upper.VisitDepthChildFirst(graft, nil)
	return failed, stackErr
}

// GetNode fetches a single node when given a slash-delimited string from root ('/') to the desired node (e.g. '/a/node/path')
func (tree *FileTree) GetNode(path string) (*FileNode, error) {
	nodeNames := strings.Split(strings.Trim(path, "/"), "/")
	node := tree.Root
	for _, name := range nodeNames {
		if name == "" {
			continue
		}
		if node.Children[name] == nil {
			return nil, fmt.Errorf("path does not exist: %s", path)
		}
		node = node.Children[name]
	}
	return node, nil
}

// AddPath adds a new node to the tree with the given payload
func (tree *FileTree) AddPath(filepath string, data FileInfo) (*FileNode, []*FileNode, error) {
	filepath = path.Clean(filepath)
	if filepath == "." {
		return nil, nil, fmt.Errorf("cannot add relative path '%s'", filepath)
	}
	nodeNames := strings.Split(strings.Trim(filepath, "/"), "/")
	node := tree.Root
	addedNodes := make([]*FileNode, 0)
	for idx, name := range nodeNames {
		if name == "" {
			continue
		}
		// find or create node
		if node.Children[name] != nil {
			node = node.Children[name]
		} else {
			// don't add paths that should be deleted
			if strings.HasPrefix(name, doubleWhiteoutPrefix) {
				return nil, addedNodes, nil
			}

			// don't attach the payload. The payload is destined for the
			// Path's end node, not any intermediary node.
			node = node.AddChild(name, FileInfo{})
			addedNodes = append(addedNodes, node)

			if node == nil {
				// the child could not be added
				return node, addedNodes, fmt.Errorf("could not add child node: '%s' (path:'%s')", name, filepath)
			}
		}

		// attach payload to the last specified node
		if idx == len(nodeNames)-1 {
			node.Data.FileInfo = data
		}
	}
	return node, addedNodes, nil
}

// RemovePath removes a node from the tree given its path.
func (tree *FileTree) RemovePath(path string) error {
	node, err := tree.GetNode(path)
	if err != nil {
		return err
	}
	return node.Remove()
}

type compareMark struct {
	lowerNode *FileNode
	upperNode *FileNode
	tentative DiffType
	final     DiffType
}

// CompareAndMark marks the FileNodes in the owning (lower) tree with DiffType annotations when compared to the given (upper) tree.
func (tree *FileTree) CompareAndMark(upper *FileTree) ([]PathError, error) {
	// always compare relative to the original, unaltered tree.
	originalTree := tree

	modifications := make([]compareMark, 0)
	failed := make([]PathError, 0)

	graft := func(upperNode *FileNode) error {
		if upperNode.IsWhiteout() {
			err := tree.markRemoved(upperNode.Path())
			if err != nil {
				failed = append(failed, NewPathError(upperNode.Path(), ActionRemove, err))
			}
			return nil
		}

		// note: since we are not comparing against the original tree (copying the tree is expensive) we may mark the parent
		// of an added node incorrectly as modified. This will be corrected later.
		originalLowerNode, _ := originalTree.GetNode(upperNode.Path())

		if originalLowerNode == nil {
			_, newNodes, err := tree.AddPath(upperNode.Path(), upperNode.Data.FileInfo)
			if err != nil {
				failed = append(failed, NewPathError(upperNode.Path(), ActionAdd, err))
				return nil
			}
			for idx := len(newNodes) - 1; idx >= 0; idx-- {
				newNode := newNodes[idx]
				modifications = append(modifications, compareMark{lowerNode: newNode, upperNode: upperNode, tentative: -1, final: Added})
			}
			return nil
		}

		// the file exists in the lower layer
		lowerNode, _ := tree.GetNode(upperNode.Path())
		diffType := lowerNode.compare(upperNode)
		modifications = append(modifications, compareMark{lowerNode: lowerNode, upperNode: upperNode, tentative: diffType, final: -1})

		return nil
	}
	// we must visit from the leaves upwards to ensure that diff types can be derived from and assigned to children
	err := upper.VisitDepthChildFirst(graft, nil)
	if err != nil {
		return failed, err
	}

	// take note of the comparison results on each note in the owning tree.
	for _, pair := range modifications {
		if pair.final > 0 {
			err = pair.lowerNode.AssignDiffType(pair.final)
			if err != nil {
				return failed, err
			}
		} else if pair.lowerNode.Data.DiffType == Unmodified {
			err = pair.lowerNode.deriveDiffType(pair.tentative)
			if err != nil {
				return failed, err
			}
		}

		// persist the upper's payload on the owning tree
		pair.lowerNode.Data.FileInfo = *pair.upperNode.Data.FileInfo.Copy()
	}
	return failed, nil
}

// markRemoved annotates the FileNode at the given path as Removed.
func (tree *FileTree) markRemoved(path string) error {
	node, err := tree.GetNode(path)
	if err != nil {
		return err
	}
	return node.AssignDiffType(Removed)
}

// StackTreeRange combines an array of trees into a single tree
func StackTreeRange(trees []*FileTree, start, stop int) (*FileTree, []PathError, error) {
	errors := make([]PathError, 0)
	tree := trees[0].Copy()
	for idx := start; idx <= stop; idx++ {
		failedPaths, err := tree.Stack(trees[idx])
		if len(failedPaths) > 0 {
			errors = append(errors, failedPaths...)
		}
		if err != nil {
			return nil, nil, fmt.Errorf("could not stack tree range: %w", err)
		}
	}
	return tree, errors, nil
}
