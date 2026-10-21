import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonContent, IonSpinner, IonText, IonCard, IonCardHeader, IonCardTitle,
  IonCardSubtitle, IonCardContent, IonItem, IonLabel, IonSelect,
  IonSelectOption, ToastController
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { refreshOutline } from 'ionicons/icons';
import { ArretService, Bus } from '../../services/arret.service';

@Component({
  selector: 'app-bus-list',
  templateUrl: './bus-list.page.html',
  styleUrls: ['./bus-list.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
    IonContent, IonSpinner, IonText, IonCard, IonCardHeader, IonCardTitle,
    IonCardSubtitle, IonCardContent, IonItem, IonLabel, IonSelect,
    IonSelectOption,
  ],
})
export class BusListPage implements OnInit {
  busList: Bus[] = [];
  etats = ['marche', 'arret', 'panne', 'transfert', 'school', 'plein'];
  loading = true;
  trajets: any[] = [];

  constructor(
    private api: ArretService,
    private toastCtrl: ToastController
  ) {
    addIcons({ refreshOutline });
  }

  ngOnInit() {
    this.chargerBus();
    this.api.getTrajets().subscribe({ next: (data) => (this.trajets = data) });
  }

  etapes(bus: Bus) {
    return this.trajets.filter((t) => t.num_ligne === bus.num_ligne);
  }

  chargerBus() {
    this.loading = true;
    this.api.getBus().subscribe({
      next: (data) => {
        this.busList = data;
        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.loading = false;
        this.showToast('Erreur de chargement des bus', 'danger');
      },
    });
  }

  changerEtat(bus: Bus, nouvelEtat: string) {
    if (nouvelEtat === bus.etat) return;

    this.api.updateEtat(bus.id, nouvelEtat).subscribe({
      next: (updated) => {
        bus.etat = updated.etat;
        this.showToast(`Bus ${bus.num_ligne} → ${nouvelEtat}`, 'success');
      },
      error: (err) => {
        console.error(err);
        this.showToast('Erreur lors de la mise à jour', 'danger');
      },
    });
  }

  couleurEtat(etat: string): string {
    switch (etat) {
      case 'marche':    return 'etat-marche';
      case 'arret':     return 'etat-arret';
      case 'panne':     return 'etat-panne';
      case 'transfert': return 'etat-transfert';
      case 'school':    return 'etat-school';
      case 'plein':     return 'etat-plein';
      default:          return '';
    }
  }

  deplacerBus(bus: Bus, ordre: number) {
    if (!ordre || ordre === bus.ordre_actuel) return;
    this.api.updatePosition(bus.id, ordre).subscribe({
      next: (updated) => {
        bus.latitude = updated.latitude;
        bus.longitude = updated.longitude;
        bus.ordre_actuel = updated.ordre_actuel;
        const etape = this.trajets.find((t) => t.num_ligne === bus.num_ligne && t.ordre === ordre);
        this.showToast(`Bus ${bus.num_ligne} placé à ${etape?.nom}`, 'success');
      },
      error: (err) => {
        console.error(err);
        this.showToast('Erreur lors du déplacement', 'danger');
      },
    });
  }
  
  private async showToast(message: string, color: string) {
    const t = await this.toastCtrl.create({
      message, duration: 1800, color, position: 'bottom',
    });
    await t.present();
  }
}