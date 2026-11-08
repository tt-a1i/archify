// Project source comes only from the captured stdin snapshot. Optional SDK
// export preparation runs in an empty directory, only for known standard
// packages; project modules, code, tests and generators are never invoked.
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
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
)

type record = map[string]interface{}
type request struct {
	Sources map[string][]byte `json:"sources"`
	Module  string            `json:"module"`
	Stdlib  bool              `json:"stdlib"`
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
	stdlib           types.Importer
	sdkExports       map[string]string
	sdkLoaded        map[string]record
	sdk              record
	req              request
	fset             *token.FileSet
	groups           map[string]*group
	packages         map[string]*group
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
	if l.req.Stdlib && p == "unsafe" {
		return types.Unsafe, nil
	}
	if _, ok := l.sdkExports[p]; ok {
		return l.stdlib.Import(p)
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

// Metadata classification comes from the SDK, never a project module lookup.
type sdkPackage struct {
	ImportPath string
	Export     string
	Standard   bool
}

func (l *loader) prepareSDK() error {
	l.sdk = record{"mode": "disabled", "packages": []record{}, "projectCommands": false, "sourceFilesAnalyzed": false}
	l.sdkLoaded = map[string]record{}
	if !l.req.Stdlib {
		return nil
	}
	l.sdk["mode"] = "compiler-exports"
	l.sdk["toolchain"] = runtime.Version()
	l.sdk["network"] = "module-proxy-and-checksum-disabled"
	// Avoid SDK subprocesses for captures that cannot import a standard package.
	potential := map[string]bool{}
	for _, file := range l.asts {
		for _, spec := range file.Imports {
			p, err := strconv.Unquote(spec.Path.Value)
			if err == nil && p == "unsafe" {
				l.sdk["intrinsicPackages"] = []string{"unsafe"}
			}
			if err == nil && l.packages[p] == nil && !strings.Contains(strings.Split(p, "/")[0], ".") && p != "unsafe" {
				potential[p] = true
			}
		}
	}
	if len(potential) == 0 {
		return nil
	}
	temporary, err := os.MkdirTemp("", "archify-go-sdk-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	goos, goarch := l.req.GOOS, l.req.GOARCH
	if goos == "" {
		goos = build.Default.GOOS
	}
	if goarch == "" {
		goarch = build.Default.GOARCH
	}
	tool := filepath.Join(runtime.GOROOT(), "bin", "go")
	if runtime.GOOS == "windows" {
		tool += ".exe"
	}
	list := func(export bool, paths []string) ([]sdkPackage, error) {
		args := []string{"list", "-json"}
		if export {
			args = append(args, "-export", "-deps")
		}
		if len(l.req.Tags) > 0 {
			args = append(args, "-tags="+strings.Join(l.req.Tags, ","))
		}
		args = append(args, paths...)
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, tool, args...)
		cmd.Dir = temporary
		cmd.Env = append(os.Environ(), "GO111MODULE=off", "GOWORK=off", "GOFLAGS=", "GOTOOLCHAIN=local", "GOENV=off", "CGO_ENABLED=0", "GOPROXY=off", "GOSUMDB=off", "GOOS="+goos, "GOARCH="+goarch)
		var errors bytes.Buffer
		cmd.Stderr = &errors
		data, err := cmd.Output()
		if err != nil {
			return nil, fmt.Errorf("SDK-only %v: %v: %s", args, err, strings.TrimSpace(errors.String()))
		}
		decoder := json.NewDecoder(bytes.NewReader(data))
		var packages []sdkPackage
		for {
			var p sdkPackage
			err := decoder.Decode(&p)
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, err
			}
			packages = append(packages, p)
		}
		return packages, nil
	}
	standard, err := list(false, []string{"std"})
	if err != nil {
		return err
	}
	wanted := []string{}
	for _, p := range standard {
		if p.Standard && potential[p.ImportPath] {
			wanted = append(wanted, p.ImportPath)
		}
	}
	sort.Strings(wanted)
	l.sdk["requestedPackages"] = wanted
	if len(wanted) == 0 {
		return nil
	}
	packages, err := list(true, wanted)
	if err != nil {
		return err
	}
	l.sdkExports = map[string]string{}
	for _, p := range packages {
		if p.Standard && p.Export != "" {
			l.sdkExports[p.ImportPath] = p.Export
		}
	}
	l.sdk["exportedDependencyCount"] = len(l.sdkExports)
	l.stdlib = importer.ForCompiler(l.fset, "gc", func(p string) (io.ReadCloser, error) {
		file, ok := l.sdkExports[p]
		if !ok {
			return nil, fmt.Errorf("SDK export unavailable for %s", p)
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		digest := sha256.Sum256(data)
		l.sdkLoaded[p] = record{"path": p, "sha256": hex.EncodeToString(digest[:]), "bytes": len(data)}
		return io.NopCloser(bytes.NewReader(data)), nil
	})
	return nil
}
func (l *loader) check(g *group) *types.Package {
	if g.pkg != nil {
		return g.pkg
	}
	g.checking = true
	defer func() { g.checking = false }()
	g.info = &types.Info{Uses: map[*ast.Ident]types.Object{}, Defs: map[*ast.Ident]types.Object{}, Selections: map[*ast.SelectorExpr]*types.Selection{}}
	g.pkg = types.NewPackage(g.pkgPath, g.name)
	goarch := l.req.GOARCH
	if goarch == "" {
		goarch = build.Default.GOARCH
	}
	cfg := types.Config{Importer: l, Sizes: types.SizesFor("gc", goarch), Error: func(err error) {
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
	if l.req.GOOS != "" {
		ctx.GOOS = l.req.GOOS
	}
	if l.req.GOARCH != "" {
		ctx.GOARCH = l.req.GOARCH
	}
	ctx.BuildTags = l.req.Tags
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
				info.reason = "external-embedded-interface"
				return false
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
			if anchor == nil {
				continue
			}
			methodRec := record{"qualname": anchor["qualname"], "name": anchor["name"], "file": anchor["file"], "line": anchor["line"], "column": defColumn(anchor)}
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
				edgeKey := fmt.Sprintf("%s|%s|%s|%d|%d|%s|%s|%d|%s", info.record["package"], info.record["qualname"], methodRec["file"], methodRec["line"], methodRec["column"], concrete.record["package"], concrete.record["qualname"], concrete.record["line"], fmt.Sprint(fn.Pos()))
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
		if ai["package"] != bi["package"] {
			return ai["package"].(string) < bi["package"].(string)
		}
		if ai["qualname"] != bi["qualname"] {
			return ai["qualname"].(string) < bi["qualname"].(string)
		}
		if am["file"] != bm["file"] {
			return am["file"].(string) < bm["file"].(string)
		}
		if am["line"] != bm["line"] {
			return am["line"].(int) < bm["line"].(int)
		}
		if am["column"] != bm["column"] {
			return am["column"].(int) < bm["column"].(int)
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
		"model":                "captured-interface-implementations-v1",
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
	l := &loader{req: req, fset: token.NewFileSet(), groups: map[string]*group{}, packages: map[string]*group{}, external: map[string]*types.Package{}, asts: map[string]*ast.File{}, invalidDirs: map[string]bool{}, definitions: map[token.Pos]record{}, interfaceMethods: map[token.Pos]record{}, selected: []string{}, excluded: []record{}, parseErrors: []record{}, functions: []record{}}
	l.prepare()
	if err := l.prepareSDK(); err != nil {
		fmt.Fprintln(os.Stderr, "Go SDK type preparation failed:", err)
		os.Exit(2)
	}
	ids := []string{}
	for id := range l.groups {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		l.check(l.groups[id])
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
					obj, ok := g.info.Uses[ident].(*types.Func)
					if selection != nil {
						obj, ok = selection.Obj().(*types.Func)
					}
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
						valid := def != nil && sig != nil && (sig.Recv() == nil || method || interfaceMethod) && !l.invalidDirs[path.Dir(file)]
						if def != nil && sig != nil && (sig.Recv() == nil || method) {
							r["reason"] = "ambiguous-binding"
						}
						if valid {
							targetFile := def["file"].(string)
							valid = !l.invalidDirs[path.Dir(targetFile)]
							targetGroup := g
							if obj.Pkg() != g.pkg {
								targetGroup = l.packages[obj.Pkg().Path()]
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
	goos, goarch := req.GOOS, req.GOARCH
	if goos == "" {
		goos = build.Default.GOOS
	}
	if goarch == "" {
		goarch = build.Default.GOARCH
	}
	interfaceEdges := l.interfaceEdges
	if interfaceEdges == nil {
		interfaceEdges = []record{}
	}
	out := record{"version": runtime.Version(), "selected": l.selected, "excluded": l.excluded, "parse_errors": l.parseErrors, "functions": l.functions, "calls": calls, "imports": imports, "packages": packages, "standardLibrary": l.sdk, "interfaceImplementations": interfaceEdges, "interfaceEvidence": l.interfaceReport, "typing": record{"status": "partial-source-bindings", "errorCount": l.errors, "errors": l.diagnostics, "externalPackagesNotLoaded": external}, "build": record{"goos": goos, "goarch": goarch, "tags": req.Tags, "cgo": false, "tests": req.Tests, "goWork": "not-loaded", "replace": "not-loaded", "releaseTags": build.Default.ReleaseTags, "toolTags": build.Default.ToolTags, "toolchain": runtime.Version(), "goFlags": "not-loaded"}}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		panic(err)
	}
}
