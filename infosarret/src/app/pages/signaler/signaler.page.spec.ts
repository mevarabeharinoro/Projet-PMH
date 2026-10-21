import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SignalerPage } from './signaler.page';

describe('SignalerPage', () => {
  let component: SignalerPage;
  let fixture: ComponentFixture<SignalerPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SignalerPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
