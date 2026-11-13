// Project source comes only from the captured stdin snapshot. Package metadata
// is loaded by go list in an isolated module; project programs, tests and
// generators are never executed. The caller owns and removes the snapshot directory.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build"
	"go/parser"
	"go/token"
	"go/types"
	"go/version"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"golang.org/x/mod/modfile"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/types/typeutil"
)

type record = map[string]interface{}
type request struct {
	ModuleText      string            `json:"moduleText"`
	LanguageVersion string            `json:"-"`
	Root            string            `json:"root"`
	Sources         map[string][]byte `json:"sources"`
	Module          string            `json:"-"`
	Stdlib          bool              `json:"stdlib"`
	GOOS            string            `json:"goos"`
	GOARCH          string            `json:"goarch"`
	Tags            []string          `json:"tags"`
	Tests           bool              `json:"tests"`
	SDK             struct {
		Version     string   `json:"version"`
		ReleaseTags []string `json:"releaseTags"`
		ToolTags    []string `json:"toolTags"`
	} `json:"sdk"`
}
type group struct {
	id, pkgPath, name string
	files             []*ast.File
	names             []string
	info              *types.Info
	pkg               *types.Package
	checking          bool
	counts            map[string]int
	methods           map[string][]types.Type
}
type interfaceInfo struct {
	named    *types.Named
	iface    *types.Interface
	record   record
	complete bool
	checked  bool
	visiting bool
	reason   string
}
type concreteType struct {
	named  *types.Named
	record record
}
type loader struct {
	sdkLoaded        map[string]record
	sdk              record
	req              request
	fset             *token.FileSet
	groups           map[string]*group
	packages         map[string]*group
	typeGroups       map[*types.Package]*group
	external         map[string]*types.Package
	diagnostics      []string
	errors           int
	asts             map[string]*ast.File
	selected         []string
	excluded         []record
	parseErrors      []record
	invalidDirs      map[string]bool
	definitions      map[token.Pos]record
	interfaceMethods map[token.Pos]record
	interfaceInfos   []*interfaceInfo
	interfaceEdges   []record
	interfaceReport  record
	functions        []record
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

// loadPackages delegates package discovery, test variants and default typing to
// public go/packages. The explicit captured-only mode uses metadata plus one
// go/types checker, because go/packages has no option to suppress SDK typing.
func (l *loader) loadPackages() error {
	l.sdk = record{"mode": "disabled", "packages": []record{}, "projectCommands": true, "sourceFilesAnalyzed": false}
	l.sdkLoaded = map[string]record{}
	root := l.req.Root
	for _, name := range l.selected {
		p := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(p, l.req.Sources[name], 0644); err != nil {
			return err
		}
	}
	// Preserve the captured scope, with no project requires, replaces, workspace,
	// generated files or module downloads. Preserve the declared language version.
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module "+strconv.Quote(l.req.Module)+"\n\ngo "+l.req.LanguageVersion+"\n"), 0644); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	env := append(os.Environ(), "GO111MODULE=on", "GOWORK=off", "GOFLAGS=", "GOTOOLCHAIN=local", "GOENV=off", "CGO_ENABLED=0", "GOPROXY=off", "GOSUMDB=off", "GOPACKAGESDRIVER=off")
	if l.req.GOOS != "" {
		env = append(env, "GOOS="+l.req.GOOS)
	}
	if l.req.GOARCH != "" {
		env = append(env, "GOARCH="+l.req.GOARCH)
	}
	flags := []string{"-mod=readonly"}
	if len(l.req.Tags) > 0 {
		flags = append(flags, "-tags="+strings.Join(l.req.Tags, ","))
	}
	mode := packages.LoadSyntax | packages.NeedExportFile | packages.NeedModule | packages.NeedForTest
	if !l.req.Stdlib {
		mode = packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedImports | packages.NeedForTest
	}
	cfg := &packages.Config{Context: ctx, Mode: mode, Dir: root, Env: env, BuildFlags: flags, Tests: l.req.Tests, Fset: l.fset,
		ParseFile: func(fs *token.FileSet, filename string, src []byte) (*ast.File, error) {
			rel, err := filepath.Rel(root, filename)
			if err != nil {
				return nil, err
			}
			if f := l.asts[filepath.ToSlash(rel)]; f != nil {
				return f, nil
			}
			return nil, fmt.Errorf("source not admitted: %s", filepath.ToSlash(rel))
		}}
	loaded, err := packages.Load(cfg, "./...")
	if err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(loaded) == 0 && len(l.asts) > 0 {
		return fmt.Errorf("no packages loaded for captured source; check SDK target and build configuration")
	}
	// A package error is partial evidence, not a fatal Load error. Preserve the
	// existing stricter per-directory parse-error binding guard independently.
	for _, p := range loaded {
		captured := false
		for _, filename := range p.GoFiles {
			rel, _ := filepath.Rel(root, filename)
			if _, ok := l.req.Sources[filepath.ToSlash(rel)]; ok {
				captured = true
				break
			}
		}
		// go list creates a test-main package outside the captured source. It is
		// intentionally not parsed; its rejection is not a project type error.
		if !captured && p.Name == "main" && strings.HasSuffix(p.PkgPath, ".test") {
			continue
		}
		for _, e := range p.Errors {
			l.errors++
			if len(l.diagnostics) < 20 {
				l.diagnostics = append(l.diagnostics, strings.ReplaceAll(e.Error(), root, "<capture>"))
			}
		}
		g := &group{id: p.PkgPath, pkgPath: p.PkgPath, name: p.Name, info: p.TypesInfo, pkg: p.Types}
		if p.ForTest != "" {
			g.id = p.ForTest + "#test:" + p.Name
		}
		for _, filename := range p.CompiledGoFiles {
			rel, _ := filepath.Rel(root, filename)
			name := filepath.ToSlash(rel)
			if f := l.asts[name]; f != nil {
				if f.Name.Name != p.Name {
					l.invalidDirs[path.Dir(name)] = true
				}
				g.files = append(g.files, f)
				g.names = append(g.names, name)
			}
		}
		if len(g.files) == 0 {
			continue
		}
		if g.info == nil && l.req.Stdlib {
			g.info = &types.Info{}
		}
		l.groups[g.id] = g
		if g.pkg != nil {
			l.typeGroups[g.pkg] = g
		}
		if p.ForTest == "" {
			l.packages[p.PkgPath] = g
		}
	}
	if l.req.Stdlib {
		l.sdk["mode"] = "compiler-exports"
		l.sdk["toolchain"] = l.req.SDK.Version
		l.sdk["network"] = "module-proxy-and-checksum-disabled"
	}
	seen := map[string]bool{}
	var visit func(*packages.Package) error
	visit = func(p *packages.Package) error {
		if seen[p.ID] {
			return nil
		}
		seen[p.ID] = true
		if p.PkgPath == "unsafe" && l.req.Stdlib {
			l.sdk["intrinsicPackages"] = []string{"unsafe"}
		}
		standard := p.PkgPath == "unsafe"
		for _, filename := range p.GoFiles {
			rel, err := filepath.Rel(filepath.Join(runtime.GOROOT(), "src"), filename)
			if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && !filepath.IsAbs(rel) {
				standard = true
				break
			}
		}
		if p.ExportFile != "" && standard && l.req.Stdlib {
			data, err := os.ReadFile(p.ExportFile)
			if err != nil {
				return err
			}
			digest := sha256.Sum256(data)
			l.sdkLoaded[p.PkgPath] = record{"path": p.PkgPath, "bytes": len(data), "sha256": hex.EncodeToString(digest[:])}
		}
		if l.packages[p.PkgPath] == nil && !standard && p.ForTest == "" && p.ExportFile == "" && !(p.Name == "main" && strings.HasSuffix(p.PkgPath, ".test")) {
			q := types.NewPackage(p.PkgPath, path.Base(p.PkgPath))
			q.MarkComplete()
			l.external[p.PkgPath] = q
		}
		for _, q := range p.Imports {
			if err := visit(q); err != nil {
				return err
			}
		}
		return nil
	}
	for _, p := range loaded {
		if err := visit(p); err != nil {
			return err
		}
	}
	return nil
}

func (l *loader) check(g *group) *types.Package {
	if g.pkg != nil {
		return g.pkg
	}
	g.checking = true
	defer func() { g.checking = false }()
	g.info = &types.Info{Types: map[ast.Expr]types.TypeAndValue{}, Uses: map[*ast.Ident]types.Object{}, Defs: map[*ast.Ident]types.Object{}, Selections: map[*ast.SelectorExpr]*types.Selection{}}
	g.pkg = types.NewPackage(g.pkgPath, g.name)
	l.typeGroups[g.pkg] = g
	cfg := types.Config{GoVersion: "go" + l.req.LanguageVersion, Importer: l, Sizes: types.SizesFor("gc", l.req.GOARCH), Error: func(err error) {
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
func positionWithin(call, span record) bool {
	line, column := call["line"].(int), call["column"].(int)
	startLine, startColumn := span["line"].(int), span["column"].(int)
	endLine, endColumn := span["endLine"].(int), span["endColumn"].(int)
	if line < startLine || line > endLine {
		return false
	}
	if line == startLine && column < startColumn {
		return false
	}
	if line == endLine && column > endColumn {
		return false
	}
	return true
}
func positionBefore(a, b record) bool {
	if a["line"].(int) != b["line"].(int) {
		return a["line"].(int) < b["line"].(int)
	}
	return a["column"].(int) < b["column"].(int)
}
func (l *loader) annotateCallers(calls []record) {
	for _, call := range calls {
		file, _ := call["file"].(string)
		var best record
		for _, def := range l.functions {
			if def["file"] != file {
				continue
			}
			kind, _ := def["definition"].(record)["kind"].(string)
			span, _ := def["sourceRange"].(record)
			if kind != "FuncDecl" || !positionWithin(call, span) {
				continue
			}
			if best == nil || positionBefore(best["sourceRange"].(record), span) {
				best = def
			}
		}
		if best == nil {
			continue
		}
		span := best["sourceRange"].(record)
		kind := "function"
		if best["qualname"] != best["name"] {
			kind = "method"
		}
		call["directCaller"] = record{"file": file, "name": best["name"], "qualname": best["qualname"], "kind": kind, "line": span["line"], "column": span["column"]}
	}
}
func (l *loader) interfaceMethod(file, owner string, name *ast.Ident, field *ast.Field) record {
	r := l.span(field)
	start, end := l.fset.PositionFor(field.Pos(), false).Offset, l.fset.PositionFor(field.End(), false).Offset
	sum := sha256.Sum256(l.req.Sources[file][start:end])
	r["sha256"] = hex.EncodeToString(sum[:])
	qualname := name.Name
	if owner != "" {
		qualname = owner + "." + qualname
	}
	return record{"file": file, "name": name.Name, "qualname": qualname, "line": r["line"], "endLine": r["endLine"], "complexity": 1, "nesting": 0, "deepestLine": r["line"], "sourceRange": r, "definition": record{"kind": "InterfaceMethod", "sourceRange": r}}
}
func (l *loader) prepare() {
	ctx := build.Default
	ctx.GOOS = l.req.GOOS
	ctx.GOARCH = l.req.GOARCH
	ctx.BuildTags = l.req.Tags
	ctx.ReleaseTags = l.req.SDK.ReleaseTags
	ctx.ToolTags = l.req.SDK.ToolTags
	ctx.CgoEnabled = false
	ctx.OpenFile = func(file string) (io.ReadCloser, error) {
		b, ok := l.req.Sources[path.Clean(filepath.ToSlash(file))]
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
		for _, decl := range f.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil {
				def := l.definition(file, fn)
				l.functions = append(l.functions, def)
				l.definitions[fn.Name.Pos()] = def
			}
		}
		owners := map[*ast.InterfaceType]string{}
		for _, decl := range f.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, spec := range gd.Specs {
				ts := spec.(*ast.TypeSpec)
				if it, ok := ts.Type.(*ast.InterfaceType); ok {
					owners[it] = ts.Name.Name
				}
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			it, ok := n.(*ast.InterfaceType)
			if !ok {
				return true
			}
			for _, field := range it.Methods.List {
				if _, ok := field.Type.(*ast.FuncType); !ok {
					continue
				}
				for _, name := range field.Names {
					def := l.interfaceMethod(file, owners[it], name, field)
					l.functions = append(l.functions, def)
					l.interfaceMethods[name.Pos()] = def
				}
			}
			return true
		})
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

// Compare receiver identities, not method spelling across unrelated types.
// Origin normalizes instantiated named receivers while retaining Go 1.18 support.
func receiverOwner(t types.Type) types.Type {
	if p, ok := t.(*types.Pointer); ok {
		t = p.Elem()
	}
	if n, ok := t.(*types.Named); ok {
		t = n.Origin()
	}
	return t
}
func (g *group) uniqueMethod(obj *types.Func) bool {
	if g.methods == nil {
		g.methods = map[string][]types.Type{}
		for _, file := range g.files {
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Recv == nil {
					continue
				}
				var owner types.Type
				if method, ok := g.info.Defs[fn.Name].(*types.Func); ok {
					if sig, ok := method.Type().(*types.Signature); ok && sig.Recv() != nil {
						owner = receiverOwner(sig.Recv().Type())
					}
				}
				g.methods[fn.Name.Name] = append(g.methods[fn.Name.Name], owner)
			}
		}
	}
	sig, ok := obj.Type().(*types.Signature)
	if !ok || sig.Recv() == nil {
		return false
	}
	owner, count := receiverOwner(sig.Recv().Type()), 0
	for _, declared := range g.methods[obj.Name()] {
		// An invalid receiver cannot establish an arbitrary first method.
		if declared == nil {
			return false
		}
		if types.Identical(owner, declared) {
			count++
		}
	}
	return count == 1
}
func interfaceSelection(selection *types.Selection) bool {
	if selection == nil || (selection.Kind() != types.MethodVal && selection.Kind() != types.MethodExpr) {
		return false
	}
	if _, typeParam := selection.Recv().(*types.TypeParam); typeParam {
		return false
	}
	_, dynamic := selection.Recv().Underlying().(*types.Interface)
	return dynamic
}
func concreteSelection(selection *types.Selection) bool {
	if selection == nil || (selection.Kind() != types.MethodVal && selection.Kind() != types.MethodExpr) {
		return false
	}
	receiver := selection.Recv()
	if p, ok := receiver.(*types.Pointer); ok {
		receiver = p.Elem()
	}
	_, dynamic := receiver.Underlying().(*types.Interface)
	return !dynamic
}

func (l *loader) namedRecord(g *group, file string, ts *ast.TypeSpec, name string) record {
	p := l.point(ts.Name.Pos())
	return record{"qualname": name, "package": g.pkg.Path(), "file": file, "line": p["line"], "column": p["column"]}
}

func defColumn(def record) int {
	if span, ok := def["sourceRange"].(record); ok {
		if column, ok := span["column"].(int); ok {
			return column
		}
	}
	return 1
}

func (l *loader) interfaceInfoFor(t types.Type) *interfaceInfo {
	for _, info := range l.interfaceInfos {
		if info.named != nil && types.Identical(t, info.named) {
			return info
		}
	}
	return nil
}

// Complete means every embedded interface is captured source (or the universe
// error type). External embeds are unknown, not "no methods".
func (l *loader) interfaceComplete(info *interfaceInfo) bool {
	if info.checked {
		return info.complete
	}
	if info.visiting {
		info.reason = "cyclic-embedded-interface"
		return false
	}
	info.visiting = true
	defer func() { info.visiting = false }()
	info.checked = true
	if info.iface == nil {
		info.reason = "incomplete-type-check"
		return false
	}
	info.iface.Complete()
	if !info.iface.IsMethodSet() {
		info.reason = "constraint-interface"
		return false
	}
	for i := 0; i < info.iface.NumEmbeddeds(); i++ {
		switch embedded := info.iface.EmbeddedType(i).(type) {
		case *types.Named:
			if embedded.Obj().Pkg() == nil {
				continue
			}
			target := l.interfaceInfoFor(embedded)
			if target == nil {
				// The method set comes from SDK/export data. Its declarations
				// have no captured source anchor, but the interface still carries
				// usable implementation evidence for captured concrete types.
				continue
			}
			if !l.interfaceComplete(target) {
				info.reason = "incomplete-embedded-interface"
				return false
			}
		case *types.Interface:
			if embedded.NumMethods() > 0 || embedded.NumEmbeddeds() > 0 {
				info.reason = "anonymous-embedded-interface"
				return false
			}
		default:
			info.reason = "unsupported-embedded-type"
			return false
		}
	}
	info.complete = true
	return true
}

func (l *loader) collectInterfaceEvidence() {
	ids := make([]string, 0, len(l.groups))
	for id := range l.groups {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var concretes []*concreteType
	generics := []record{}
	for _, id := range ids {
		g := l.groups[id]
		if g.info == nil || g.pkg == nil {
			continue
		}
		for i, f := range g.files {
			file := g.names[i]
			if l.invalidDirs[path.Dir(file)] {
				continue
			}
			for _, decl := range f.Decls {
				gd, ok := decl.(*ast.GenDecl)
				if !ok || gd.Tok != token.TYPE {
					continue
				}
				for _, spec := range gd.Specs {
					ts := spec.(*ast.TypeSpec)
					obj, _ := g.info.Defs[ts.Name].(*types.TypeName)
					if obj == nil || obj.IsAlias() {
						continue
					}
					named, ok := obj.Type().(*types.Named)
					if !ok {
						continue
					}
					_, isInterface := ts.Type.(*ast.InterfaceType)
					rec := l.namedRecord(g, file, ts, ts.Name.Name)
					if named.TypeParams().Len() > 0 {
						if isInterface {
							generics = append(generics, rec)
						}
						continue
					}
					if isInterface {
						iface, _ := named.Underlying().(*types.Interface)
						if iface == nil {
							continue
						}
						l.interfaceInfos = append(l.interfaceInfos, &interfaceInfo{named: named, iface: iface, record: rec})
						continue
					}
					if _, dynamic := named.Underlying().(*types.Interface); dynamic {
						continue
					}
					concretes = append(concretes, &concreteType{named: named, record: rec})
				}
			}
		}
	}
	sort.Slice(l.interfaceInfos, func(i, j int) bool {
		a, b := l.interfaceInfos[i].record, l.interfaceInfos[j].record
		if a["package"] != b["package"] {
			return a["package"].(string) < b["package"].(string)
		}
		if a["file"] != b["file"] {
			return a["file"].(string) < b["file"].(string)
		}
		if a["line"] != b["line"] {
			return a["line"].(int) < b["line"].(int)
		}
		return a["qualname"].(string) < b["qualname"].(string)
	})
	sort.Slice(concretes, func(i, j int) bool {
		a, b := concretes[i].record, concretes[j].record
		if a["package"] != b["package"] {
			return a["package"].(string) < b["package"].(string)
		}
		if a["file"] != b["file"] {
			return a["file"].(string) < b["file"].(string)
		}
		if a["line"] != b["line"] {
			return a["line"].(int) < b["line"].(int)
		}
		return a["qualname"].(string) < b["qualname"].(string)
	})
	edges := []record{}
	seen := map[string]bool{}
	edgeInterfaces := map[string]bool{}
	complete := map[string]bool{}
	incomplete := []record{}
	incompleteSeen := map[string]bool{}
	without := []record{}
	withoutSeen := map[string]bool{}
	if generics == nil {
		generics = []record{}
	}
	for _, info := range l.interfaceInfos {
		key := fmt.Sprintf("%s|%s|%s|%d", info.record["package"], info.record["qualname"], info.record["file"], info.record["line"])
		if !l.interfaceComplete(info) {
			if !incompleteSeen[key] {
				incompleteSeen[key] = true
				incomplete = append(incomplete, record{"interface": info.record, "reason": info.reason})
			}
			continue
		}
		complete[key] = true
		if info.iface.NumMethods() == 0 {
			continue
		}
		emitted := false
		for i := 0; i < info.iface.NumMethods(); i++ {
			method := info.iface.Method(i)
			anchor := l.interfaceMethods[method.Pos()]
			var methodRec record
			if anchor != nil {
				methodRec = record{"qualname": anchor["qualname"], "name": anchor["name"], "file": anchor["file"], "line": anchor["line"], "column": defColumn(anchor)}
			} else if method.Pkg() != nil {
				// A promoted method from an uncaptured interface. Keep the
				// declaration identity, but do not invent a source location.
				methodRec = record{"qualname": method.Pkg().Name() + "." + method.Name(), "name": method.Name(), "package": method.Pkg().Path(), "external": true}
			} else {
				continue
			}
			for _, concrete := range concretes {
				value := types.Implements(concrete.named, info.iface)
				pointer := types.Implements(types.NewPointer(concrete.named), info.iface)
				if !value && !pointer {
					continue
				}
				methodSet := "value"
				set := types.NewMethodSet(concrete.named)
				if !value {
					methodSet = "pointer"
					set = types.NewMethodSet(types.NewPointer(concrete.named))
				}
				selection := set.Lookup(method.Pkg(), method.Name())
				if selection == nil {
					continue
				}
				fn, ok := selection.Obj().(*types.Func)
				if !ok {
					continue
				}
				implementation := record{"type": concrete.record, "valueSatisfies": value, "pointerSatisfies": pointer, "methodSet": methodSet}
				if def := l.definitions[fn.Pos()]; def != nil {
					implementation["method"] = record{"qualname": def["qualname"], "file": def["file"], "line": def["line"], "column": defColumn(def)}
					implementation["reason"] = "captured-concrete-method"
				} else if promoted := l.interfaceMethods[fn.Pos()]; promoted != nil {
					implementation["promotedDeclaration"] = record{"qualname": promoted["qualname"], "file": promoted["file"], "line": promoted["line"], "column": defColumn(promoted)}
					implementation["reason"] = "promoted-interface-method"
				} else {
					implementation["reason"] = "method-body-not-captured"
				}
				edge := record{"interface": info.record, "method": methodRec, "implementation": implementation}
				edgeKey := fmt.Sprintf("%s|%s|%v|%v|%v|%s|%s|%d|%s", info.record["package"], info.record["qualname"], methodRec["file"], methodRec["line"], methodRec["column"], concrete.record["package"], concrete.record["qualname"], concrete.record["line"], fmt.Sprint(fn.Pos()))
				if seen[edgeKey] {
					emitted = true
					continue
				}
				seen[edgeKey] = true
				edgeInterfaces[key] = true
				edges = append(edges, edge)
				emitted = true
			}
		}
		if !emitted && !withoutSeen[key] {
			withoutSeen[key] = true
			without = append(without, record{"interface": info.record, "reason": "no-captured-implementation"})
		}
	}
	filtered := without[:0]
	for _, row := range without {
		rec := row["interface"].(record)
		key := fmt.Sprintf("%s|%s|%s|%d", rec["package"], rec["qualname"], rec["file"], rec["line"])
		if !edgeInterfaces[key] {
			filtered = append(filtered, row)
		}
	}
	without = filtered
	sort.Slice(edges, func(i, j int) bool {
		a, b := edges[i], edges[j]
		ai, bi := a["interface"].(record), b["interface"].(record)
		am, bm := a["method"].(record), b["method"].(record)
		fieldString := func(r record, key string) string {
			value, _ := r[key].(string)
			return value
		}
		fieldInt := func(r record, key string) int {
			value, _ := r[key].(int)
			return value
		}
		if fieldString(ai, "package") != fieldString(bi, "package") {
			return fieldString(ai, "package") < fieldString(bi, "package")
		}
		if fieldString(ai, "qualname") != fieldString(bi, "qualname") {
			return fieldString(ai, "qualname") < fieldString(bi, "qualname")
		}
		if fieldString(am, "file") != fieldString(bm, "file") {
			return fieldString(am, "file") < fieldString(bm, "file")
		}
		if fieldInt(am, "line") != fieldInt(bm, "line") {
			return fieldInt(am, "line") < fieldInt(bm, "line")
		}
		if fieldInt(am, "column") != fieldInt(bm, "column") {
			return fieldInt(am, "column") < fieldInt(bm, "column")
		}
		at, bt := a["implementation"].(record)["type"].(record), b["implementation"].(record)["type"].(record)
		if at["package"] != bt["package"] {
			return at["package"].(string) < bt["package"].(string)
		}
		if at["qualname"] != bt["qualname"] {
			return at["qualname"].(string) < bt["qualname"].(string)
		}
		return at["line"].(int) < bt["line"].(int)
	})
	l.interfaceEdges = edges
	l.interfaceReport = record{
		"model":                "captured-interface-implementations-v2",
		"completeInterfaces":   len(complete),
		"incompleteInterfaces": incomplete,
		"genericInterfaces":    generics,
		"interfacesWithoutCapturedImplementations": without,
		"edges": len(edges),
	}
}

func (l *loader) receiverInterface(t types.Type) record {
	for _, info := range l.interfaceInfos {
		if info.named != nil && types.Identical(t, info.named) {
			return info.record
		}
	}
	return nil
}

func (l *loader) declarationInterface(anchor record) record {
	owner, _ := anchor["qualname"].(string)
	if i := strings.LastIndex(owner, "."); i >= 0 {
		owner = owner[:i]
	}
	file, _ := anchor["file"].(string)
	for _, info := range l.interfaceInfos {
		if info.record["qualname"] == owner && info.record["file"] == file {
			return info.record
		}
	}
	return nil
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

	req.LanguageVersion = "1.16"
	if req.ModuleText != "" {
		module, err := modfile.Parse("go.mod", []byte(req.ModuleText), nil)
		if err != nil || module.Module == nil {
			fmt.Fprintln(os.Stderr, "invalid root go.mod:", err)
			os.Exit(2)
		}
		req.Module = module.Module.Mod.Path
		if module.Go != nil {
			req.LanguageVersion = module.Go.Version
		}
	}
	if req.Module == "" || req.Root == "" {
		fmt.Fprintln(os.Stderr, "captured root module and isolated directory required")
		os.Exit(2)
	}
	if version.Compare(version.Lang(req.SDK.Version), version.Lang(runtime.Version())) > 0 {
		fmt.Fprintf(os.Stderr, "project SDK %s is newer than helper compiler %s; omit ARCHIFY_GO_BUILD or select a matching or newer build SDK\n", req.SDK.Version, runtime.Version())
		os.Exit(2)
	}
	l := &loader{req: req, fset: token.NewFileSet(), groups: map[string]*group{}, packages: map[string]*group{}, typeGroups: map[*types.Package]*group{}, external: map[string]*types.Package{}, asts: map[string]*ast.File{}, invalidDirs: map[string]bool{}, definitions: map[token.Pos]record{}, interfaceMethods: map[token.Pos]record{}, selected: []string{}, excluded: []record{}, parseErrors: []record{}, functions: []record{}}
	l.prepare()
	if err := l.loadPackages(); err != nil {
		fmt.Fprintln(os.Stderr, "Go package loading failed:", err)
		os.Exit(2)
	}
	ids := []string{}
	for id := range l.groups {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if !req.Stdlib {
			l.check(l.groups[id])
		}
	}
	l.collectInterfaceEvidence()
	calls, imports, packages := []record{}, []record{}, []record{}
	for _, id := range ids {
		g := l.groups[id]
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
				var selection *types.Selection
				switch x := unwrap(call.Fun).(type) {
				case *ast.Ident:
					ident = x
				case *ast.SelectorExpr:
					ident = x.Sel
					selection = g.info.Selections[x]
				}
				if ident != nil {
					r["reason"] = "no-local-function-binding"
					obj, ok := typeutil.Callee(g.info, call).(*types.Func)
					if ok {
						sig, _ := obj.Type().(*types.Signature)
						if sig != nil && sig.Recv() != nil {
							r["reason"] = "go-method-dispatch"
						}
						method := sig != nil && sig.Recv() != nil && concreteSelection(selection)
						interfaceMethod := sig != nil && sig.Recv() != nil && interfaceSelection(selection)
						def := l.definitions[obj.Pos()]
						if interfaceMethod {
							def = l.interfaceMethods[obj.Pos()]
						}
						promotedInterface := false
						if method && def == nil {
							if anchor := l.interfaceMethods[obj.Pos()]; anchor != nil {
								method = false
								interfaceMethod = true
								promotedInterface = true
								def = anchor
							}
						}
						if interfaceMethod && selection != nil {
							if recv := l.receiverInterface(selection.Recv()); recv != nil {
								r["receiverInterface"] = recv
							}
							if def == nil && obj.Pkg() != nil {
								r["interfaceMethod"] = record{"package": obj.Pkg().Path(), "qualname": obj.Pkg().Name() + "." + obj.Name(), "name": obj.Name()}
								r["reason"] = "go-interface-external-method"
							}
						}
						valid := def != nil && sig != nil && (sig.Recv() == nil || method || interfaceMethod) && !l.invalidDirs[path.Dir(file)]
						if def != nil && sig != nil && (sig.Recv() == nil || method) {
							r["reason"] = "ambiguous-binding"
						}
						if valid {
							targetFile := def["file"].(string)
							valid = !l.invalidDirs[path.Dir(targetFile)]
							targetGroup := g
							if obj.Pkg() != g.pkg {
								targetGroup = l.typeGroups[obj.Pkg()]
								if targetGroup == nil {
									targetGroup = l.packages[obj.Pkg().Path()]
								}
							}
							if method {
								valid = valid && targetGroup != nil && targetGroup.uniqueMethod(obj)
							}
							if interfaceMethod {
								valid = valid && targetGroup != nil
							}
							if !method && !interfaceMethod && obj.Pkg() == g.pkg && counts[obj.Name()] != 1 {
								valid = false
							}
							if !method && !interfaceMethod && obj.Pkg() != g.pkg && targetGroup != nil {
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
								if method {
									r["resolution"] = "go-direct-method"
								}
								if interfaceMethod {
									r["resolution"] = "go-interface-method"
									recv := l.receiverInterface(selection.Recv())
									if recv == nil {
										recv = l.declarationInterface(def)
									}
									if recv != nil {
										r["receiverInterface"] = recv
									}
									if promotedInterface {
										r["receiverPromotion"] = "embedded-interface"
									}
								}
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
	l.annotateCallers(calls)
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
	sdkPaths := []string{}
	for p := range l.sdkLoaded {
		sdkPaths = append(sdkPaths, p)
	}
	sort.Strings(sdkPaths)
	sdkPackages := []record{}
	for _, p := range sdkPaths {
		sdkPackages = append(sdkPackages, l.sdkLoaded[p])
	}
	l.sdk["packages"] = sdkPackages
	external := []string{}
	for p := range l.external {
		external = append(external, p)
	}
	sort.Strings(external)
	interfaceEdges := l.interfaceEdges
	if interfaceEdges == nil {
		interfaceEdges = []record{}
	}
	toolModules, toolsVersion := []record{}, "unknown"
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			toolModules = append(toolModules, record{"path": dep.Path, "version": dep.Version, "sum": dep.Sum})
			if dep.Path == "golang.org/x/tools" {
				toolsVersion = dep.Version
			}
		}
	}
	mode := "go-packages"
	if !req.Stdlib {
		mode = "captured-go-types"
	}
	loading := record{"version": toolsVersion, "toolModules": toolModules, "mode": mode, "scope": "captured-root-module", "languageVersion": req.LanguageVersion, "toolchain": runtime.Version(), "projectToolchain": req.SDK.Version, "dependencies": "not-loaded", "network": "disabled", "projectCodeExecuted": false}
	out := record{"module": req.Module, "selected": l.selected, "excluded": l.excluded, "parse_errors": l.parseErrors, "functions": l.functions, "calls": calls, "imports": imports, "packages": packages, "standardLibrary": l.sdk, "interfaceImplementations": interfaceEdges, "interfaceEvidence": l.interfaceReport, "typing": record{"status": "partial-source-bindings", "errorCount": l.errors, "errors": l.diagnostics, "externalPackagesNotLoaded": external}, "build": record{"goos": req.GOOS, "goarch": req.GOARCH, "tags": req.Tags, "cgo": false, "tests": req.Tests, "goWork": "not-loaded", "replace": "not-loaded", "releaseTags": req.SDK.ReleaseTags, "toolTags": req.SDK.ToolTags, "toolchain": req.SDK.Version, "goFlags": "not-loaded"}}
	out["loader"] = loading
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}
