import { Component, model, OnInit } from "@angular/core";
import { ApiRenderer } from "api-render-ui"
import { AstTreeNode } from "../../model";

@Component({
    selector: '[api-notebook]',
    templateUrl: './api-notebook.component.html',
    styleUrls: ['./api-notebook.component.css'],
    standalone: true
})
export class ApiNoteBookComponent implements OnInit {

    data = model<AstTreeNode>()


    ngOnInit(): void {
        let data = this.data();
        const openapiSpec: any = data?.sourceCodeText != null ? JSON.parse(data?.sourceCodeText) : {}
        if (!openapiSpec || !openapiSpec.paths) {
            // alert('⚠️ Please define `openapiSpec` in the script tag.');
            return;
        }
        requestAnimationFrame(()=> {
        //    initNotebook();
            const apiRenderer = new ApiRenderer({
                mountPoint: '#notebook', // 可以是选择器字符串
            });
            // 执行渲染
            apiRenderer.render(openapiSpec);
        })
    }
}

