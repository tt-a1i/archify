// This program analyzes only the immutable sources supplied on stdin. It never
// loads project packages, runs project code, invokes go list, or downloads modules.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"path"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

type record = map[string]interface{}
type request struct {
	Sources map[string][]byte `json:"sources"`
	Module  string            `json:"module"`
	GOOS    string            `json:"goos"`
	GOARCH  string            `json:"goarch"`
	Tags    []string          `json:"tags"`
	Tests   bool              `json:"tests"`
}
type group struct {
	id, pkgPath, name string
	files             []*ast.File
	names             []string
	info              *types.Info
	pkg               *types.Package
	checking          bool
	counts            map[string]int
}
type loader struct {
	req         request
	fset        *token.FileSet
	groups      map[string]*group
	packages    map[string]*group
	external    map[string]*types.Package
	diagnostics []string
	errors      int
	asts        map[string]*ast.File
	selected    []string
	excluded    []record
	parseErrors []record
	invalidDirs map[string]bool
	definitions map[token.Pos]record
	functions   []record
}

func (l *loader) Import(p string) (*types.Package, error) {
	if g := l.packages[p]; g != nil {
		if g.checking {
			return nil, fmt.Errorf("import cycle involving %s", p)
		}
		return l.check(g), nil
	}
	if q := l.external[p]; q != nil {
		return q, nil
	}
	// External packages deliberately have no declarations. Incomplete typing is
	// reported; missing external symbols cannot manufacture a project target.
	q := types.NewPackage(p, path.Base(p))
	q.MarkComplete()
	l.external[p] = q
	return q, nil
}
func (l *loader) check(g *group) *types.Package {
	if g.pkg != nil {
		return g.pkg
	}
	g.checking = true
	defer func() { g.checking = false }()
	g.info = &types.Info{Uses: map[*ast.Ident]types.Object{}, Defs: map[*ast.Ident]types.Object{}}
	g.pkg = types.NewPackage(g.pkgPath, g.name)
	cfg := types.Config{Importer: l, Error: func(err error) {
		l.errors++
		if len(l.diagnostics) < 20 {
			l.diagnostics = append(l.diagnostics, err.Error())
		}
	}}
	_ = types.NewChecker(&cfg, l.fset, g.pkg, g.info).Files(g.files)
	return g.pkg
}
func (l *loader) point(p token.Pos) record {
	pos := l.fset.PositionFor(p, false)
	b := l.req.Sources[pos.Filename]
	start := pos.Offset
	for start > 0 && b[start-1] != '\n' {
		start--
	}
	col := 1
	for _, r := range string(b[start:pos.Offset]) {
		col += utf16.RuneLen(r)
	}
	return record{"line": pos.Line, "column": col}
}
func (l *loader) span(n ast.Node) record {
	a, b := l.point(n.Pos()), l.point(n.End())
	return record{"line": a["line"], "column": a["column"], "endLine": b["line"], "endColumn": b["column"]}
}
func (l *loader) definition(file string, fn *ast.FuncDecl) record {
	r := l.span(fn)
	start, end := l.fset.PositionFor(fn.Pos(), false).Offset, l.fset.PositionFor(fn.End(), false).Offset
	sum := sha256.Sum256(l.req.Sources[file][start:end])
	r["sha256"] = hex.EncodeToString(sum[:])
	qualname := fn.Name.Name
	if fn.Recv != nil && len(fn.Recv.List) > 0 {
		var buf bytes.Buffer // receiver source keeps pointer/generic identity without pretending dispatch.
		a, b := l.fset.PositionFor(fn.Recv.List[0].Type.Pos(), false).Offset, l.fset.PositionFor(fn.Recv.List[0].Type.End(), false).Offset
		buf.Write(l.req.Sources[file][a:b])
		qualname = buf.String() + "." + qualname
	}
	complexity, nesting, deepest := 1, 0, r["line"].(int)
	var visit func(ast.Node, int)
	visit = func(n ast.Node, depth int) {
		if n == nil {
			return
		}
		ast.Inspect(n, func(child ast.Node) bool {
			if child == nil {
				return false
			}
			if child == n {
				return true
			}
			if _, ok := child.(*ast.FuncLit); ok {
				return false
			}
			branch := false
			switch x := child.(type) {
			case *ast.IfStmt, *ast.ForStmt, *ast.RangeStmt:
				complexity++
				branch = true
			case *ast.SwitchStmt, *ast.TypeSwitchStmt, *ast.SelectStmt:
				branch = true
			case *ast.CaseClause:
				if len(x.List) > 0 {
					complexity++
				}
			case *ast.CommClause:
				if x.Comm != nil {
					complexity++
				}
			case *ast.BinaryExpr:
				if x.Op == token.LAND || x.Op == token.LOR {
					complexity++
				}
			}
			if branch {
				d := depth + 1
				if d > nesting {
					nesting = d
					deepest = l.fset.PositionFor(child.Pos(), false).Line
				}
				visit(child, d)
				return false
			}
			return true
		})
	}
	visit(fn.Body, 0)
	return record{"file": file, "name": fn.Name.Name, "qualname": qualname, "line": r["line"], "endLine": r["endLine"], "complexity": complexity, "nesting": nesting, "deepestLine": deepest, "sourceRange": r, "definition": record{"kind": "FuncDecl", "sourceRange": r}}
}
func (l *loader) prepare() {
	ctx := build.Default
	if l.req.GOOS != "" {
		ctx.GOOS = l.req.GOOS
	}
	if l.req.GOARCH != "" {
		ctx.GOARCH = l.req.GOARCH
	}
	ctx.BuildTags = l.req.Tags
	ctx.CgoEnabled = false
	ctx.OpenFile = func(file string) (io.ReadCloser, error) {
		b, ok := l.req.Sources[path.Clean(file)]
		if !ok {
			return nil, os.ErrNotExist
		}
		return io.NopCloser(bytes.NewReader(b)), nil
	}
	names := make([]string, 0, len(l.req.Sources))
	for f := range l.req.Sources {
		names = append(names, f)
	}
	sort.Strings(names)
	for _, file := range names {
		if !l.req.Tests && strings.HasSuffix(file, "_test.go") {
			l.excluded = append(l.excluded, record{"file": file, "reason": "tests-disabled"})
			continue
		}
		matched, err := ctx.MatchFile(path.Dir(file), path.Base(file))
		if err != nil {
			l.selected = append(l.selected, file)
			l.parseErrors = append(l.parseErrors, record{"path": file, "message": err.Error()})
			l.invalidDirs[path.Dir(file)] = true
			continue
		}
		if !matched {
			l.excluded = append(l.excluded, record{"file": file, "reason": "build-conditions-or-filename"})
			continue
		}
		f, err := parser.ParseFile(l.fset, file, l.req.Sources[file], parser.AllErrors|parser.ParseComments)
		l.selected = append(l.selected, file)
		if err != nil {
			l.parseErrors = append(l.parseErrors, record{"path": file, "message": err.Error()})
			l.invalidDirs[path.Dir(file)] = true
			continue
		}
		cgo := false
		for _, imp := range f.Imports {
			if imp.Path.Value == `"C"` {
				cgo = true
			}
		}
		if cgo {
			l.selected = l.selected[:len(l.selected)-1]
			l.excluded = append(l.excluded, record{"file": file, "reason": "cgo-not-loaded"})
			continue
		}
		l.asts[file] = f
	}
	// Imported packages are built only from production files. Internal tests use
	// a separate production+test variant; external tests never merge declarations.
	for _, file := range l.selected {
		f := l.asts[file]
		if f == nil {
			continue
		}
		dir := path.Dir(file)
		pkgPath := l.req.Module
		if dir != "." {
			pkgPath += "/" + dir
		}
		id := pkgPath
		if strings.HasSuffix(file, "_test.go") {
			id += "#test:" + f.Name.Name
		}
		g := l.groups[id]
		if g == nil {
			g = &group{id: id, pkgPath: pkgPath, name: f.Name.Name}
			l.groups[id] = g
		}
		if g.name != f.Name.Name {
			l.invalidDirs[dir] = true
		}
		g.files = append(g.files, f)
		g.names = append(g.names, file)
		if !strings.HasSuffix(file, "_test.go") {
			l.packages[pkgPath] = g
		}
		for _, decl := range f.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil {
				def := l.definition(file, fn)
				l.functions = append(l.functions, def)
				if fn.Recv == nil {
					l.definitions[fn.Name.Pos()] = def
				}
			}
		}
	}
	for _, g := range l.groups {
		if !strings.Contains(g.id, "#test:") {
			continue
		}
		p := l.packages[g.pkgPath]
		if p != nil && g.name == p.name {
			g.files = append(append([]*ast.File{}, p.files...), g.files...)
			g.names = append(append([]string{}, p.names...), g.names...)
		} else {
			g.pkgPath += "_test"
		}
	}
}

// A function/value/type collision is invalid Go, not an arbitrary first target.
func declarationCounts(files []*ast.File) map[string]int {
	counts := map[string]int{}
	for _, f := range files {
		for _, decl := range f.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				if d.Recv == nil {
					counts[d.Name.Name]++
				}
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch x := spec.(type) {
					case *ast.ValueSpec:
						for _, name := range x.Names {
							counts[name.Name]++
						}
					case *ast.TypeSpec:
						counts[x.Name.Name]++
					}
				}
			}
		}
	}
	return counts
}

func unwrap(e ast.Expr) ast.Expr {
	switch x := e.(type) {
	case *ast.ParenExpr:
		return unwrap(x.X)
	case *ast.IndexExpr:
		return unwrap(x.X)
	case *ast.IndexListExpr:
		return unwrap(x.X)
	}
	return e
}
func main() {
	var req request
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		panic(err)
	}
	l := &loader{req: req, fset: token.NewFileSet(), groups: map[string]*group{}, packages: map[string]*group{}, external: map[string]*types.Package{}, asts: map[string]*ast.File{}, invalidDirs: map[string]bool{}, definitions: map[token.Pos]record{}, selected: []string{}, excluded: []record{}, parseErrors: []record{}, functions: []record{}}
	l.prepare()
	ids := []string{}
	for id := range l.groups {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	calls, imports, packages := []record{}, []record{}, []record{}
	for _, id := range ids {
		g := l.groups[id]
		l.check(g)
		packages = append(packages, record{"id": g.id, "path": g.pkgPath, "name": g.name, "files": g.names})
		if g.counts == nil {
			g.counts = declarationCounts(g.files)
		}
		counts := g.counts
		for i, f := range g.files {
			file := g.names[i]
			isTest := strings.HasSuffix(file, "_test.go")
			if strings.Contains(g.id, "#test:") && !isTest {
				continue
			}
			for _, imp := range f.Imports {
				p, err := strconv.Unquote(imp.Path.Value)
				if err != nil {
					continue
				}
				edge := record{"from": file, "specifier": p, "kind": "static", "line": l.fset.PositionFor(imp.Pos(), false).Line, "resolved": false}
				if imp.Name != nil {
					edge["names"] = []string{imp.Name.Name}
				}
				if target := l.packages[p]; target != nil && !l.invalidDirs[path.Dir(target.names[0])] {
					for _, to := range target.names {
						e := record{}
						for k, v := range edge {
							e[k] = v
						}
						e["resolved"] = true
						e["to"] = to
						imports = append(imports, e)
					}
				} else {
					imports = append(imports, edge)
				}
			}
			ast.Inspect(f, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				r := l.span(call)
				r["file"] = file
				r["resolution"] = "unresolved"
				r["reason"] = "unsupported-callee"
				var ident *ast.Ident
				switch x := unwrap(call.Fun).(type) {
				case *ast.Ident:
					ident = x
				case *ast.SelectorExpr:
					ident = x.Sel
				}
				if ident != nil {
					if obj, ok := g.info.Uses[ident].(*types.Func); ok {
						sig, _ := obj.Type().(*types.Signature)
						def := l.definitions[obj.Pos()]
						valid := def != nil && sig != nil && sig.Recv() == nil && !l.invalidDirs[path.Dir(file)]
						if valid {
							targetFile := def["file"].(string)
							valid = !l.invalidDirs[path.Dir(targetFile)]
							if obj.Pkg() == g.pkg && counts[obj.Name()] != 1 {
								valid = false
							}
							if targetGroup := l.packages[obj.Pkg().Path()]; obj.Pkg() != g.pkg && targetGroup != nil {
								if targetGroup.counts == nil {
									targetGroup.counts = declarationCounts(targetGroup.files)
								}
								n := targetGroup.counts[obj.Name()]
								if n != 1 {
									valid = false
								}
							}
							if valid {
								span := def["sourceRange"].(record)
								t := record{"name": def["name"], "line": span["line"], "column": span["column"]}
								r["resolution"] = "go-direct-function"
								if targetFile != file {
									t["file"] = targetFile
								}
								r["target"] = t
								delete(r, "reason")
							}
						}
					}
				}
				calls = append(calls, r)
				return true
			})
		}
	}
	sort.Slice(calls, func(i, j int) bool {
		a, b := calls[i], calls[j]
		if a["file"] != b["file"] {
			return a["file"].(string) < b["file"].(string)
		}
		if a["line"] != b["line"] {
			return a["line"].(int) < b["line"].(int)
		}
		return a["column"].(int) < b["column"].(int)
	})
	external := []string{}
	for p := range l.external {
		external = append(external, p)
	}
	sort.Strings(external)
	goos, goarch := req.GOOS, req.GOARCH
	if goos == "" {
		goos = build.Default.GOOS
	}
	if goarch == "" {
		goarch = build.Default.GOARCH
	}
	out := record{"version": runtime.Version(), "selected": l.selected, "excluded": l.excluded, "parse_errors": l.parseErrors, "functions": l.functions, "calls": calls, "imports": imports, "packages": packages, "typing": record{"status": "partial-source-bindings", "errorCount": l.errors, "errors": l.diagnostics, "externalPackagesNotLoaded": external}, "build": record{"goos": goos, "goarch": goarch, "tags": req.Tags, "cgo": false, "tests": req.Tests, "goWork": "not-loaded", "replace": "not-loaded", "releaseTags": build.Default.ReleaseTags, "toolchain": runtime.Version(), "goFlags": "not-loaded"}}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}
