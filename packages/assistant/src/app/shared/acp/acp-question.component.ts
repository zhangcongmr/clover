import { Component, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options: QuestionOption[];
}

const CUSTOM_ANSWER_KEY = '__custom__';

@Component({
  selector: 'app-acp-question',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './acp-question.component.html',
  styleUrls: ['./acp-question.component.css']
})
export class AcpQuestionComponent {
  questions = input.required<QuestionItem[]>();
  toolCallId = input.required<string>();
  submitted = input<boolean>(false);

  onSubmit = output<string[]>();
  onIgnore = output<void>();

  collapsed = signal(false);
  currentIndex = signal(0);
  answers = signal<Map<number, string>>(new Map());
  customInputs = signal<Map<number, string>>(new Map());

  total = computed(() => this.questions().length);
  currentQuestion = computed(() => this.questions()[this.currentIndex()]);
  isFirst = computed(() => this.currentIndex() === 0);
  isLast = computed(() => this.currentIndex() === this.total() - 1);

  currentAnswer = computed(() => this.answers().get(this.currentIndex()));

  selectAnswer(qIndex: number, label: string): void {
    this.answers.update(m => {
      const next = new Map(m);
      next.set(qIndex, label);
      return next;
    });
  }

  onCustomInput(qIndex: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.customInputs.update(m => {
      const next = new Map(m);
      next.set(qIndex, value);
      return next;
    });
    this.answers.update(m => {
      const next = new Map(m);
      next.set(qIndex, CUSTOM_ANSWER_KEY);
      return next;
    });
  }

  nextQuestion(): void {
    if (this.currentIndex() < this.total() - 1) {
      this.currentIndex.update(i => i + 1);
    }
  }

  prevQuestion(): void {
    if (this.currentIndex() > 0) {
      this.currentIndex.update(i => i - 1);
    }
  }

  goToQuestion(index: number): void {
    if (index >= 0 && index < this.total()) {
      this.currentIndex.set(index);
    }
  }

  allAnswered(): boolean {
    const ans = this.answers();
    for (let i = 0; i < this.total(); i++) {
      if (!ans.has(i)) return false;
    }
    return true;
  }

  submitAll(): void {
    if (!this.allAnswered()) return;

    const result: string[] = [];
    const ans = this.answers();
    const customs = this.customInputs();

    for (let i = 0; i < this.total(); i++) {
      const answer = ans.get(i);
      if (answer === CUSTOM_ANSWER_KEY) {
        result.push(customs.get(i) || '');
      } else {
        result.push(answer || '');
      }
    }

    this.onSubmit.emit(result);
  }

  ignore(): void {
    this.onIgnore.emit();
  }

  toggleCollapse(): void {
    this.collapsed.update(v => !v);
  }

  isSelected(qIndex: number, label: string): boolean {
    return this.answers().get(qIndex) === label;
  }

  isCustomSelected(qIndex: number): boolean {
    return this.answers().get(qIndex) === CUSTOM_ANSWER_KEY;
  }
}
