package filetree

import (
	"fmt"
	"github.com/stretchr/testify/assert"
	"testing"
)

func stringInSlice(a string, list []string) bool {
	for _, b := range list {
		if b == a {
			return true
		}
	}
	return false
}

func AssertDiffType(node *FileNode, expectedDiffType DiffType) error {
	if node.Data.DiffType != expectedDiffType {
		return fmt.Errorf("Expecting node at %s to have DiffType %v, but had %v", node.Path(), expectedDiffType, node.Data.DiffType)
	}
	return nil
}

func TestStringCollapsed(t *testing.T) {
	tree := NewFileTree()
	tree.Root.AddChild("1 node!", FileInfo{})
	two := tree.Root.AddChild("2 node!", FileInfo{})
	subTwo := two.AddChild("2 child!", FileInfo{})
	subTwo.AddChild("2 grandchild!", FileInfo{})
	subTwo.Data.ViewInfo.Collapsed = true
	three := tree.Root.AddChild("3 node!", FileInfo{})
	subThree := three.AddChild("3 child!", FileInfo{})
	three.AddChild("3 nested child 1!", FileInfo{})
	threeGc1 := subThree.AddChild("3 grandchild 1!", FileInfo{})
	threeGc1.AddChild("3 greatgrandchild 1!", FileInfo{})
	subThree.AddChild("3 grandchild 2!", FileInfo{})
	four := tree.Root.AddChild("4 node!", FileInfo{})
	four.Data.ViewInfo.Collapsed = true
	tree.Root.AddChild("5 node!", FileInfo{})
	four.AddChild("6, one level down...", FileInfo{})

	expected :=
		`├── 1 node!
├── 2 node!
│   └─⊕ 2 child!
├── 3 node!
│   ├── 3 child!
│   │   ├── 3 grandchild 1!
│   │   │   └── 3 greatgrandchild 1!
│   │   └── 3 grandchild 2!
│   └── 3 nested child 1!
├─⊕ 4 node!
└── 5 node!
`
	actual := tree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestString(t *testing.T) {
	tree := NewFileTree()
	tree.Root.AddChild("1 node!", FileInfo{})
	tree.Root.AddChild("2 node!", FileInfo{})
	tree.Root.AddChild("3 node!", FileInfo{})
	four := tree.Root.AddChild("4 node!", FileInfo{})
	tree.Root.AddChild("5 node!", FileInfo{})
	four.AddChild("6, one level down...", FileInfo{})

	expected :=
		`├── 1 node!
├── 2 node!
├── 3 node!
├── 4 node!
│   └── 6, one level down...
└── 5 node!
`
	actual := tree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestStringBetween(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("/etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/etc/nginx/public", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/systemd", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp/nonsense", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	expected :=
		`│       └── public
├── tmp
│   └── nonsense
`
	actual := tree.StringBetween(3, 5, false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestRejectPurelyRelativePath(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("./etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("./", FileInfo{})

	if err == nil {
		t.Errorf("expected to reject relative path, but did not")
	}

}

func TestAddRelativePath(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("./etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	expected :=
		`└── etc
    └── nginx
        └── nginx.conf
`
	actual := tree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestAddPath(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("/etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/etc/nginx/public", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/systemd", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp/nonsense", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	expected :=
		`├── etc
│   └── nginx
│       ├── nginx.conf
│       └── public
├── tmp
│   └── nonsense
└── var
    └── run
        ├── bashful
        └── systemd
`
	actual := tree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestAddWhiteoutPath(t *testing.T) {
	tree := NewFileTree()
	node, _, err := tree.AddPath("usr/local/lib/python3.7/site-packages/pip/.wh..wh..opq", FileInfo{})
	if err != nil {
		t.Errorf("expected no error but got: %v", err)
	}
	if node != nil {
		t.Errorf("expected node to be nil, but got: %v", node)
	}
	expected :=
		`└── usr
    └── local
        └── lib
            └── python3.7
                └── site-packages
                    └── pip
`
	actual := tree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}
}

func TestRemovePath(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("/etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/etc/nginx/public", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/systemd", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp/nonsense", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	err = tree.RemovePath("/var/run/bashful")
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	err = tree.RemovePath("/tmp")
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	expected :=
		`├── etc
│   └── nginx
│       ├── nginx.conf
│       └── public
└── var
    └── run
        └── systemd
`
	actual := tree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestStack(t *testing.T) {
	payloadKey := "/var/run/systemd"
	payloadValue := FileInfo{
		Path: "yup",
	}

	tree1 := NewFileTree()

	_, _, err := tree1.AddPath("/etc/nginx/public", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree1.AddPath(payloadKey, FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree1.AddPath("/var/run/bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree1.AddPath("/tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree1.AddPath("/tmp/nonsense", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	tree2 := NewFileTree()
	// add new files
	_, _, err = tree2.AddPath("/etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	// modify current files
	_, _, err = tree2.AddPath(payloadKey, payloadValue)
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	// whiteout the following files
	_, _, err = tree2.AddPath("/var/run/.wh.bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree2.AddPath("/.wh.tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	// ignore opaque whiteout files entirely
	node, _, err := tree2.AddPath("/.wh..wh..opq", FileInfo{})
	if err != nil {
		t.Errorf("expected no error on whiteout file add, but got %v", err)
	}
	if node != nil {
		t.Errorf("expected no node on whiteout file add, but got %v", node)
	}

	failedPaths, err := tree1.Stack(tree2)

	if err != nil {
		t.Errorf("Could not stack refTrees: %v", err)
	}

	if len(failedPaths) > 0 {
		t.Errorf("expected no filepath errors, got %d", len(failedPaths))
	}

	expected :=
		`├── etc
│   └── nginx
│       ├── nginx.conf
│       └── public
└── var
    └── run
        └── systemd
`

	node, err = tree1.GetNode(payloadKey)
	if err != nil {
		t.Errorf("Expected '%s' to still exist, but it doesn't", payloadKey)
	}

	if node == nil || node.Data.FileInfo.Path != payloadValue.Path {
		t.Errorf("Expected '%s' value to be %+v but got %+v", payloadKey, payloadValue, node.Data.FileInfo)
	}

	actual := tree1.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestCopy(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("/etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/etc/nginx/public", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/systemd", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp/nonsense", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	err = tree.RemovePath("/var/run/bashful")
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	err = tree.RemovePath("/tmp")
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	expected :=
		`├── etc
│   └── nginx
│       ├── nginx.conf
│       └── public
└── var
    └── run
        └── systemd
`

	NewFileTree := tree.Copy()
	actual := NewFileTree.String(false)

	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}

func TestCompareWithNoChanges(t *testing.T) {
	lowerTree := NewFileTree()
	upperTree := NewFileTree()
	paths := [...]string{"/etc", "/etc/sudoers", "/etc/hosts", "/usr/bin", "/usr/bin/bash", "/usr"}

	for _, value := range paths {
		fakeData := FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		}
		_, _, err := lowerTree.AddPath(value, fakeData)
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
		_, _, err = upperTree.AddPath(value, fakeData)
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}
	failedPaths, err := lowerTree.CompareAndMark(upperTree)
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	if len(failedPaths) > 0 {
		t.Errorf("expected no filepath errors, got %d", len(failedPaths))
	}
	asserter := func(n *FileNode) error {
		if n.Path() == "/" {
			return nil
		}
		if (n.Data.DiffType) != Unmodified {
			t.Errorf("Expecting node at %s to have DiffType unchanged, but had %v", n.Path(), n.Data.DiffType)
		}
		return nil
	}
	err = lowerTree.VisitDepthChildFirst(asserter, nil)
	if err != nil {
		t.Error(err)
	}
}

func TestCompareWithAdds(t *testing.T) {
	lowerTree := NewFileTree()
	upperTree := NewFileTree()
	lowerPaths := [...]string{"/etc", "/etc/sudoers", "/usr", "/etc/hosts", "/usr/bin"}
	upperPaths := [...]string{"/etc", "/etc/sudoers", "/usr", "/etc/hosts", "/usr/bin", "/usr/bin/bash", "/a/new/path"}

	for _, value := range lowerPaths {
		_, _, err := lowerTree.AddPath(value, FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		})
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}

	for _, value := range upperPaths {
		_, _, err := upperTree.AddPath(value, FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		})
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}

	failedAssertions := []error{}
	failedPaths, err := lowerTree.CompareAndMark(upperTree)
	if err != nil {
		t.Errorf("Expected tree compare to have no errors, got: %v", err)
	}
	if len(failedPaths) > 0 {
		t.Errorf("expected no filepath errors, got %d", len(failedPaths))
	}
	asserter := func(n *FileNode) error {

		p := n.Path()
		if p == "/" {
			return nil
		} else if stringInSlice(p, []string{"/usr/bin/bash", "/a", "/a/new", "/a/new/path"}) {
			if err := AssertDiffType(n, Added); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		} else if stringInSlice(p, []string{"/usr/bin", "/usr"}) {
			if err := AssertDiffType(n, Modified); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		} else {
			if err := AssertDiffType(n, Unmodified); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		}
		return nil
	}
	err = lowerTree.VisitDepthChildFirst(asserter, nil)
	if err != nil {
		t.Errorf("Expected no errors when visiting nodes, got: %+v", err)
	}

	if len(failedAssertions) > 0 {
		str := "\n"
		for _, value := range failedAssertions {
			str += fmt.Sprintf("  - %s\n", value.Error())
		}
		t.Errorf("Expected no errors when evaluating nodes, got: %s", str)
	}
}

func TestCompareWithChanges(t *testing.T) {
	lowerTree := NewFileTree()
	upperTree := NewFileTree()
	changedPaths := []string{"/etc", "/usr", "/etc/hosts", "/etc/sudoers", "/usr/bin"}

	for _, value := range changedPaths {
		_, _, err := lowerTree.AddPath(value, FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		})
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
		_, _, err = upperTree.AddPath(value, FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     456,
		})
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}

	chmodPath := "/etc/non-data-change"

	_, _, err := lowerTree.AddPath(chmodPath, FileInfo{
		Path:     chmodPath,
		TypeFlag: 1,
		hash:     123,
		Mode:     0,
	})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	_, _, err = upperTree.AddPath(chmodPath, FileInfo{
		Path:     chmodPath,
		TypeFlag: 1,
		hash:     123,
		Mode:     1,
	})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	changedPaths = append(changedPaths, chmodPath)

	chownPath := "/etc/non-data-change-2"

	_, _, err = lowerTree.AddPath(chmodPath, FileInfo{
		Path:     chownPath,
		TypeFlag: 1,
		hash:     123,
		Mode:     1,
		Gid:      0,
		Uid:      0,
	})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	_, _, err = upperTree.AddPath(chmodPath, FileInfo{
		Path:     chownPath,
		TypeFlag: 1,
		hash:     123,
		Mode:     1,
		Gid:      12,
		Uid:      12,
	})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	changedPaths = append(changedPaths, chownPath)

	failedPaths, err := lowerTree.CompareAndMark(upperTree)
	if err != nil {
		t.Errorf("unable to compare and mark: %+v", err)
	}
	if len(failedPaths) > 0 {
		t.Errorf("expected no filepath errors, got %d", len(failedPaths))
	}
	failedAssertions := []error{}
	asserter := func(n *FileNode) error {
		p := n.Path()
		if p == "/" {
			return nil
		} else if stringInSlice(p, changedPaths) {
			if err := AssertDiffType(n, Modified); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		} else {
			if err := AssertDiffType(n, Unmodified); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		}
		return nil
	}
	err = lowerTree.VisitDepthChildFirst(asserter, nil)
	if err != nil {
		t.Errorf("Expected no errors when visiting nodes, got: %+v", err)
	}

	if len(failedAssertions) > 0 {
		str := "\n"
		for _, value := range failedAssertions {
			str += fmt.Sprintf("  - %s\n", value.Error())
		}
		t.Errorf("Expected no errors when evaluating nodes, got: %s", str)
	}
}

func TestCompareWithRemoves(t *testing.T) {
	lowerTree := NewFileTree()
	upperTree := NewFileTree()
	lowerPaths := [...]string{"/etc", "/usr", "/etc/hosts", "/etc/sudoers", "/usr/bin", "/root", "/root/example", "/root/example/some1", "/root/example/some2"}
	upperPaths := [...]string{"/.wh.etc", "/usr", "/usr/.wh.bin", "/root/.wh.example"}

	for _, value := range lowerPaths {
		fakeData := FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		}
		_, _, err := lowerTree.AddPath(value, fakeData)
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}

	for _, value := range upperPaths {
		fakeData := FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		}
		_, _, err := upperTree.AddPath(value, fakeData)
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}

	failedPaths, err := lowerTree.CompareAndMark(upperTree)
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	if len(failedPaths) > 0 {
		t.Errorf("expected no filepath errors, got %d", len(failedPaths))
	}
	failedAssertions := []error{}
	asserter := func(n *FileNode) error {
		p := n.Path()
		if p == "/" {
			return nil
		} else if stringInSlice(p, []string{"/etc", "/usr/bin", "/etc/hosts", "/etc/sudoers", "/root/example/some1", "/root/example/some2", "/root/example"}) {
			if err := AssertDiffType(n, Removed); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		} else if stringInSlice(p, []string{"/usr", "/root"}) {
			if err := AssertDiffType(n, Modified); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		} else {
			if err := AssertDiffType(n, Unmodified); err != nil {
				failedAssertions = append(failedAssertions, err)
			}
		}
		return nil
	}
	err = lowerTree.VisitDepthChildFirst(asserter, nil)
	if err != nil {
		t.Errorf("Expected no errors when visiting nodes, got: %+v", err)
	}

	if len(failedAssertions) > 0 {
		str := "\n"
		for _, value := range failedAssertions {
			str += fmt.Sprintf("  - %s\n", value.Error())
		}
		t.Errorf("Expected no errors when evaluating nodes, got: %s", str)
	}
}

func TestStackRange(t *testing.T) {
	tree := NewFileTree()
	_, _, err := tree.AddPath("/etc/nginx/nginx.conf", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/etc/nginx/public", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/systemd", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/var/run/bashful", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	_, _, err = tree.AddPath("/tmp/nonsense", FileInfo{})
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	err = tree.RemovePath("/var/run/bashful")
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}
	err = tree.RemovePath("/tmp")
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	lowerTree := NewFileTree()
	upperTree := NewFileTree()
	lowerPaths := [...]string{"/etc", "/usr", "/etc/hosts", "/etc/sudoers", "/usr/bin"}
	upperPaths := [...]string{"/etc", "/usr", "/etc/hosts", "/etc/sudoers", "/usr/bin"}

	for _, value := range lowerPaths {
		fakeData := FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		}
		_, _, err = lowerTree.AddPath(value, fakeData)
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}

	for _, value := range upperPaths {
		fakeData := FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     456,
		}
		_, _, err = upperTree.AddPath(value, fakeData)
		if err != nil {
			t.Errorf("could not setup test: %v", err)
		}
	}
	trees := []*FileTree{lowerTree, upperTree, tree}
	_, failedPaths, err := StackTreeRange(trees, 0, 2)
	if len(failedPaths) > 0 {
		t.Errorf("expected no filepath errors, got %d", len(failedPaths))
	}
	assert.NoError(t, err)
}

func TestRemoveOnIterate(t *testing.T) {

	tree := NewFileTree()
	paths := [...]string{"/etc", "/usr", "/etc/hosts", "/etc/sudoers", "/usr/bin", "/usr/something"}

	for _, value := range paths {
		fakeData := FileInfo{
			Path:     value,
			TypeFlag: 1,
			hash:     123,
		}
		node, _, err := tree.AddPath(value, fakeData)
		if err == nil && stringInSlice(node.Path(), []string{"/etc"}) {
			node.Data.ViewInfo.Hidden = true
		}
	}

	err := tree.VisitDepthChildFirst(func(node *FileNode) error {
		if node.Data.ViewInfo.Hidden {
			err := tree.RemovePath(node.Path())
			if err != nil {
				t.Errorf("could not setup test: %v", err)
			}
		}
		return nil
	}, nil)
	if err != nil {
		t.Errorf("could not setup test: %v", err)
	}

	expected :=
		`└── usr
    ├── bin
    └── something
`
	actual := tree.String(false)
	if expected != actual {
		t.Errorf("Expected tree string:\n--->%s<---\nGot:\n--->%s<---", expected, actual)
	}

}
