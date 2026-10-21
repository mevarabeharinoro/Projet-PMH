import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ArretService } from '../services/arret.service';
import { RouterLink } from '@angular/router';
import { IonHeader, IonToolbar, IonTitle, IonContent, ToastController, IonButton} from '@ionic/angular';
import { Geolocation } from '@capacitor/geolocation';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButton,
  ],
})
export class HomePage {
  nomArret = '';
  numBus = '';
  numLigne = '';
  direction = '';
  etat = 'default';

  constructor(
    private arretService: ArretService,
    private toastController: ToastController
  ) {}

  async validerCollecte() {
    let latitude: number | null = null;
    let longitude: number | null = null;

    try {
      const position = await Geolocation.getCurrentPosition();
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
    } catch (err) {
      console.error('Erreur GPS', err);
      this.presentToast('Impossible de récupérer la position GPS', 'danger');
      return;
    }

    const arret = {
      nomArret: this.nomArret,
      numBus: this.numBus,
      numLigne: this.numLigne,
      direction: this.direction,
      etat: this.etat,
      latitude,
      longitude,
    };

    this.arretService.ajouterArret(arret).subscribe({
      next: () => {
        this.presentToast('Collecte validée avec succès !', 'success');
        this.resetFormulaire();
      },
      error: (err) => {
        console.error('Erreur lors de l\'enregistrement', err);
        this.presentToast('Erreur lors de l\'enregistrement', 'danger');
      },
    });
  }

  resetFormulaire() {
    this.nomArret = '';
    this.numBus = '';
    this.numLigne = '';
    this.direction = '';
    this.etat = 'default';
  }

  async presentToast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'top',
    });
    await toast.present();
  }
}
