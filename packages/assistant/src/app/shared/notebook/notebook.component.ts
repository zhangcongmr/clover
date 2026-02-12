import { Component, computed, model, OnInit, output, Signal } from "@angular/core";
import { AstTreeNode } from "../model";
import { ApiNoteBookComponent } from "./openapi/api-notebook.component";
import { MarkdownComponent } from "./markdown/markdown.component";


@Component({
    selector: '[notebook]',
    templateUrl: './notebook.component.html',
    styleUrls: ['./notebook.component.css'],
    standalone: true,
    imports: [MarkdownComponent, ApiNoteBookComponent]
})
export class NoteBookComponent implements OnInit {

    data = model<AstTreeNode>()
    readonly saved = output();

    fileType: Signal<string> = computed(()=> {
        const data = this.data()
        if(data) {
            const fileName = data.label;
            if(fileName.endsWith(".json")) {
                return 'json'
            } else {
                return 'text'
            }
        }
        return 'text'
    })


    ngOnInit(): void {
    }

    saveText(evt: any) {
        this.saved.emit(evt)
    }
}

