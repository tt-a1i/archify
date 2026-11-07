// Independent compiler-API observations, before a product method-binding rule.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"runtime"
)

const source = `package sample
 type Base struct{}
 func (*Base) M(){}
 type Contract interface{M()}
 type Promoted struct{*Base}
 type Field struct{M func()}
 type Generic[T any] struct{}
 func (*Generic[T]) M(){}
 type Alias = Base
 func probe(b *Base, c Contract, p *Promoted, f Field, g *Generic[int], a *Alias){
 b.M()
 c.M()
 p.M()
 f.M()
 g.M()
 (*Base).M(b)
 a.M()
 }
`

func main() {
	set := token.NewFileSet()
	file, err := parser.ParseFile(set, "sample.go", source, 0)
	if err != nil {
		panic(err)
	}
	info := &types.Info{Uses: map[*ast.Ident]types.Object{}, Selections: map[*ast.SelectorExpr]*types.Selection{}}
	config := types.Config{}
	_, err = config.Check("sample", set, []*ast.File{file}, info)
	if err != nil {
		panic(err)
	}
	rows := []map[string]interface{}{}
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		selection := info.Selections[sel]
		if selection == nil {
			panic("missing selection")
		}
		row := map[string]interface{}{"line": set.Position(call.Pos()).Line, "selectionKind": int(selection.Kind()), "receiver": selection.Recv().String(), "index": selection.Index(), "objectKind": fmt.Sprintf("%T", selection.Obj()), "declLine": set.Position(selection.Obj().Pos()).Line}
		if sig, ok := selection.Obj().Type().(*types.Signature); ok {
			row["receiverTypeParameters"] = sig.RecvTypeParams().Len()
		}
		rows = append(rows, row)
		return true
	})
	// These explicit facts come from the authored source declarations, not the
	// product implementation. Promoted and method-expression calls still have
	// compiler-known targets; excluding them later must not count as accuracy wins.
	expectedLines := []int{3, 4, 3, 6, 8, 3, 3}
	expectedKinds := []types.SelectionKind{types.MethodVal, types.MethodVal, types.MethodVal, types.FieldVal, types.MethodVal, types.MethodExpr, types.MethodVal}
	if len(rows) != len(expectedLines) {
		panic("wrong number of calls")
	}
	for i, row := range rows {
		if row["declLine"] != expectedLines[i] || row["selectionKind"] != int(expectedKinds[i]) {
			panic(fmt.Sprintf("wrong compiler attribution %d: %v", i, row))
		}
	}
	report := map[string]interface{}{"toolchain": runtime.Version(), "source": source, "rows": rows, "limits": "Compiler attribution for authored source only, not product support or real-project/runtime evidence. Interface declaration is not a concrete implementation."}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		panic(err)
	}
}
