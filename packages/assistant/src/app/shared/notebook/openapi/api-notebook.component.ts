import { Component, ElementRef, model, OnInit, viewChild } from "@angular/core";
import { ApiRenderer } from "api-render-ui"
import { AstTreeNode } from "../../model";

@Component({
    selector: '[api-notebook]',
    templateUrl: './api-notebook.component.html',
    styleUrls: ['./api-notebook.component.css'],
    standalone: true
})
export class ApiNoteBookComponent implements OnInit {
    apiOperatorListView = viewChild<ElementRef<HTMLElement>>('apiOperatorList');
    data = model<AstTreeNode>()


    ngOnInit(): void {
        let data = this.data();
        requestAnimationFrame(()=> {
        //    initNotebook();
            const apiOperatorListView = this.apiOperatorListView()
            const apiRenderer = new ApiRenderer({
                mountPoint: apiOperatorListView?.nativeElement, // 可以是选择器字符串
            });
            // 执行渲染
            apiRenderer.render(data?.content ?? '');
        })
    }
}

