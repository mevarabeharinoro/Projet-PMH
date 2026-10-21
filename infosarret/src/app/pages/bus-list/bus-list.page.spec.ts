import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BusListPage } from './bus-list.page';

describe('BusListPage', () => {
  let component: BusListPage;
  let fixture: ComponentFixture<BusListPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(BusListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
