// Independent full-project attribution; this tool is not shipped in the analyzer.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/tools/go/packages"
)

type Target struct {
	File   string `json:"file"`
	Name   string `json:"name"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}
type Call struct {
	File       string  `json:"file"`
	Line       int     `json:"line"`
	Column     int     `json:"column"`
	EndLine    int     `json:"endLine"`
	EndColumn  int     `json:"endColumn"`
	Resolution string  `json:"resolution"`
	Target     *Target `json:"target,omitempty"`
}
type Source struct {
	Path string `json:"path"`
	Text string `json:"sourceText"`
}
type Facts struct {
	Calls []Call   `json:"calls"`
	Files []Source `json:"files"`
}
type Decl struct {
	Name       string
	NameLine   int
	NameColumn int
	Target     Target
}

func read(file string, v interface{}) {
	b, e := os.ReadFile(file)
	if e != nil {
		panic(e)
	}
	if e = json.Unmarshal(b, v); e != nil {
		panic(e)
	}
}
func key(c Call) string {
	return fmt.Sprintf("%s:%d:%d:%d:%d", c.File, c.Line, c.Column, c.EndLine, c.EndColumn)
}
func utf16Column(text string, offset int) int {
	start := offset
	for start > 0 && text[start-1] != '\n' {
		start--
	}
	n := 1
	for _, r := range text[start:offset] {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}
func main() {
	rootArg := flag.String("root", "", "pinned module root")
	baseArg := flag.String("baseline", "", "baseline facts")
	headArg := flag.String("candidate", "", "candidate facts")
	outArg := flag.String("out", "", "JSON output")
	flag.Parse()
	if *outArg == "" {
		panic("pass root, baseline, candidate and out")
	}
	root, e := filepath.EvalSymlinks(*rootArg)
	if e != nil {
		panic(e)
	}
	root, e = filepath.Abs(root)
	if e != nil {
		panic(e)
	}
	var base, head Facts
	read(*baseArg, &base)
	read(*headArg, &head)
	old := map[string]Call{}
	for _, c := range base.Calls {
		old[key(c)] = c
	}
	allCalls := map[string]Call{}
	wanted := map[string]Call{}
	for _, c := range head.Calls {
		allCalls[key(c)] = c
		if c.Target != nil && old[key(c)].Target == nil {
			wanted[key(c)] = c
		}
	}
	texts := map[string]string{}
	decls := map[string][]Decl{}
	parseSet := token.NewFileSet()
	for _, f := range head.Files {
		abs := filepath.Join(root, filepath.FromSlash(f.Path))
		bytes, err := os.ReadFile(abs)
		if err != nil || string(bytes) != f.Text {
			panic("source differs from capture: " + f.Path)
		}
		texts[f.Path] = f.Text
		tree, err := parser.ParseFile(parseSet, abs, f.Text, 0)
		if err != nil {
			continue
		}
		for _, node := range tree.Decls {
			fn, ok := node.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			name, start := parseSet.Position(fn.Name.Pos()), parseSet.Position(fn.Pos())
			decls[f.Path] = append(decls[f.Path], Decl{fn.Name.Name, name.Line, name.Column, Target{f.Path, fn.Name.Name, start.Line, utf16Column(f.Text, start.Offset)}})
		}
	}
	started := time.Now()
	cfg := &packages.Config{Dir: root, Tests: true, Mode: packages.LoadSyntax, Env: append(os.Environ(), "CGO_ENABLED=0", "GOFLAGS=", "GOWORK=off", "GOENV=off", "GOTOOLCHAIN=local"), BuildFlags: []string{"-mod=readonly"}}
	loaded, err := packages.Load(cfg, "./...")
	if err != nil {
		panic(err)
	}
	rows := []map[string]interface{}{}
	errors := []map[string]interface{}{}
	seen := map[string]bool{}
	methodCoverage := map[string]int{"compilerKnownBodies": 0, "baselineCorrect": 0, "baselineWrong": 0, "baselineMissed": 0, "candidateCorrect": 0, "candidateWrong": 0, "candidateMissed": 0}
	knownMisses := []map[string]interface{}{}
	for _, pkg := range loaded {
		for _, err := range pkg.Errors {
			errors = append(errors, map[string]interface{}{"package": pkg.ID, "kind": err.Kind, "message": err.Msg, "position": err.Pos})
		}
		for _, file := range pkg.Syntax {
			abs := pkg.Fset.Position(file.Pos()).Filename
			rel, err := filepath.Rel(root, abs)
			if err != nil {
				continue
			}
			rel = filepath.ToSlash(rel)
			text, exists := texts[rel]
			if !exists {
				continue
			}
			// Match the product's separate production/internal/external-test variants.
			if strings.Contains(pkg.ID, "[") && !strings.HasSuffix(rel, "_test.go") {
				continue
			}
			ast.Inspect(file, func(n ast.Node) bool {
				node, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				a, b := pkg.Fset.Position(node.Pos()), pkg.Fset.Position(node.End())
				call := Call{File: rel, Line: a.Line, Column: utf16Column(text, a.Offset), EndLine: b.Line, EndColumn: utf16Column(text, b.Offset)}
				k := key(call)
				request, ok := allCalls[k]
				if !ok || seen[k] {
					return true
				}
				seen[k] = true
				expr := node.Fun
				for {
					p, ok := expr.(*ast.ParenExpr)
					if !ok {
						break
					}
					expr = p.X
				}
				selector, ok := expr.(*ast.SelectorExpr)
				var selection *types.Selection
				if ok {
					selection = pkg.TypesInfo.Selections[selector]
				}
				row := map[string]interface{}{"call": request, "package": pkg.ID, "status": "compiler-unavailable"}
				if selection != nil && (selection.Kind() == types.MethodVal || selection.Kind() == types.MethodExpr) {
					row["receiver"] = selection.Recv().String()
					row["selectionKind"] = int(selection.Kind())
					row["index"] = selection.Index()
					obj := selection.Obj()
					position := pkg.Fset.Position(obj.Pos())
					targetFile, err := filepath.Rel(root, position.Filename)
					targetFile = filepath.ToSlash(targetFile)
					matches := []Target{}
					if err == nil {
						for _, decl := range decls[targetFile] {
							if decl.Name == obj.Name() && decl.NameLine == position.Line {
								matches = append(matches, decl.Target)
							}
						}
					}
					if len(matches) == 1 {
						target := matches[0]
						row["compilerTarget"] = target
						methodCoverage["compilerKnownBodies"]++
						for _, side := range []string{"baseline", "candidate"} {
							captured := request
							if side == "baseline" {
								captured = old[k]
							}
							grade := "Missed"
							if captured.Target != nil {
								if sameTarget(captured, target) {
									grade = "Correct"
								} else {
									grade = "Wrong"
								}
							}
							methodCoverage[side+grade]++
							if side == "candidate" && grade != "Correct" {
								knownMisses = append(knownMisses, map[string]interface{}{"call": request, "compilerTarget": target, "grade": grade, "package": pkg.ID})
							}
						}
						if sameTarget(request, target) {
							row["status"] = "compiler-agreed"
						} else {
							row["status"] = "compiler-disagreed"
						}
					}
				}
				if _, added := wanted[k]; added {
					rows = append(rows, row)
				}
				return true
			})
		}
	}
	for k, call := range wanted {
		if !seen[k] {
			rows = append(rows, map[string]interface{}{"call": call, "status": "call-not-found"})
		}
	}
	counts := map[string]int{"compiler-agreed": 0, "compiler-disagreed": 0, "compiler-unavailable": 0, "call-not-found": 0}
	for _, r := range rows {
		counts[r["status"].(string)]++
	}
	report := map[string]interface{}{"toolchain": runtime.Version(), "tools": "golang.org/x/tools v0.52.0", "mode": "Full project Go package/type attribution, tests enabled, cgo disabled, readonly module graph. Never executes project tests or modules. Product uses incomplete captured source typing; this audit uses the configured live compiler graph after source byte checks.", "seconds": time.Since(started).Seconds(), "packages": len(loaded), "errors": errors, "counts": counts, "methodCoverage": methodCoverage, "knownMisses": knownMisses, "rows": rows}
	bytes, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		panic(err)
	}
	if err = os.WriteFile(*outArg, append(bytes, '\n'), 0644); err != nil {
		panic(err)
	}
	fmt.Println(string(mustJSON(map[string]interface{}{"counts": counts, "methodCoverage": methodCoverage, "errors": len(errors), "seconds": time.Since(started).Seconds()})))
	if counts["compiler-disagreed"] > 0 || counts["call-not-found"] > 0 {
		os.Exit(1)
	}
}
func sameTarget(call Call, target Target) bool {
	if call.Target == nil {
		return false
	}
	actual := *call.Target
	if actual.File == "" {
		actual.File = call.File
	}
	return actual == target
}
func mustJSON(v interface{}) []byte {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}
