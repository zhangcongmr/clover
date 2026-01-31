import { Component, OnInit } from '@angular/core';
import { CreateMLCEngine } from "@mlc-ai/web-llm";

@Component({
    selector: 'app-webllm',
    templateUrl: './webllm.component.html',
    styleUrls: ['./webllm.component.css'],
    standalone: true
})
export class WebllmComponent implements OnInit {

  constructor() { }

  ngOnInit() {
    this.createEngine()
  }

  async createEngine() {
    //https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f32_1-MLC/resolve/main/mlc-chat-config.json
    // Callback function to update model loading progress
    const initProgressCallback = (initProgress: any) => {
      console.log(initProgress);
    }
    const selectedModel = "Llama-3.1-8B-Instruct-q4f32_1-MLC";

    const engine = await CreateMLCEngine(
      selectedModel,
      { initProgressCallback: initProgressCallback }, // engineConfig
    );

    const messages: any = [
      { role: "system", content: "You are a helpful AI luxio." },
      { role: "user", content: "Hello!" },
    ]
    
    const reply = await engine.chat.completions.create({
      messages,
    });
    console.log(reply.choices[0].message);
    console.log(reply.usage);
  }

}
